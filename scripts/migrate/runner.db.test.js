// 마이그레이션 러너 — 실제 Postgres로 검증한다(목으로는 트랜잭션·잠금·DDL 동작을 증명할 수 없다).
//
// TEST_DATABASE_URL이 없으면 **실패**한다(skip 아님) — 검사하지 못한 것은 통과가 아니다.
// 로컬: docker run -d --rm --name smarthub-pg-test -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:17
//       TEST_DATABASE_URL=postgres://postgres:test@localhost:55432/postgres npm run test:db
// 테스트마다 고유 스키마를 만들고 search_path를 거기로 둔다 — 서로의 schema_migrations가 섞이지 않게.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { migrate, status, MigrationError } from './runner.mjs'
import { describeSchema, diffSchemas } from './diff.mjs'

const URL = process.env.TEST_DATABASE_URL

describe('러너 (실DB)', () => {
  let root, schema, clients

  const connect = async () => {
    const c = new pg.Client({ connectionString: URL, options: `-c search_path=${schema}` })
    await c.connect()
    clients.push(c)
    return c
  }
  const put = (scope, file, sql) => writeFileSync(join(root, scope, file), sql)
  const rows = async (c, sql) => (await c.query(sql)).rows
  const exists = async (c, table) => (await rows(c, `select to_regclass('${schema}.${table}') as t`))[0].t !== null

  beforeEach(async () => {
    if (!URL) throw new Error('TEST_DATABASE_URL이 없다 — 실DB 테스트는 건너뛰지 않는다(docker postgres:17 띄우고 지정할 것)')
    root = mkdtempSync(join(tmpdir(), 'mig-db-'))
    mkdirSync(join(root, 'common'))
    mkdirSync(join(root, 'external'))
    schema = `t_${Math.random().toString(36).slice(2, 10)}`
    clients = []
    const admin = new pg.Client({ connectionString: URL })
    await admin.connect()
    await admin.query(`create schema ${schema}`)
    await admin.end()
  })

  afterEach(async () => {
    for (const c of clients) await c.end().catch(() => {})
    if (URL) {
      const admin = new pg.Client({ connectionString: URL })
      await admin.connect()
      await admin.query(`drop schema if exists ${schema} cascade`)
      await admin.end()
    }
    rmSync(root, { recursive: true, force: true })
  })

  it('빈 DB에 순서대로 적용하고 기록한다', async () => {
    put('common', '20261110000000_a.sql', 'create table a (id int);')
    put('common', '20261111000000_b.sql', 'create table b (a_id int);')
    const c = await connect()
    const r = await migrate(c, { root, scopes: ['common'] })
    expect(r.applied).toEqual(['20261110000000', '20261111000000'])
    expect((await rows(c, 'select version, scope from schema_migrations order by version'))).toEqual([
      { version: '20261110000000', scope: 'common' }, { version: '20261111000000', scope: 'common' },
    ])
  })

  it('두 번째 실행은 0건', async () => {
    put('common', '20261110000000_a.sql', 'create table a (id int);')
    const c = await connect()
    await migrate(c, { root, scopes: ['common'] })
    expect((await migrate(c, { root, scopes: ['common'] })).applied).toEqual([])
  })

  it('scope를 고른 대로만 적용한다 — 사내는 common만', async () => {
    put('common', '20261110000000_a.sql', 'create table a (id int);')
    put('external', '20261111000000_rls.sql', 'alter table a enable row level security;')
    const c = await connect()
    expect((await migrate(c, { root, scopes: ['common'] })).applied).toEqual(['20261110000000'])
  })

  it('rolls back the failing file only', async () => {
    put('common', '20261110000000_a.sql', 'create table a (id int);')
    put('common', '20261111000000_b.sql', 'create table b (id int); select 문법오류;')
    const c = await connect()
    await expect(migrate(c, { root, scopes: ['common'] })).rejects.toThrow()
    expect(await exists(c, 'a')).toBe(true)
    expect(await exists(c, 'b')).toBe(false)
    expect((await rows(c, 'select version from schema_migrations')).map((x) => x.version)).toEqual(['20261110000000'])
  })

  it('checksum mismatch면 아무것도 적용하지 않는다', async () => {
    put('common', '20261110000000_a.sql', 'create table a (id int);')
    const c = await connect()
    await migrate(c, { root, scopes: ['common'] })
    put('common', '20261110000000_a.sql', 'create table a (id bigint);')
    put('common', '20261112000000_c.sql', 'create table c (id int);')
    const err = await migrate(c, { root, scopes: ['common'] }).catch((e) => e)
    expect(err).toBeInstanceOf(MigrationError)
    expect(err.code).toBe('CHECKSUM_MISMATCH')
    expect(await exists(c, 'c')).toBe(false)
  })

  it('refuses baseline on non-empty db', async () => {
    put('common', '20261110000000_baseline.sql', 'create table hubs (id int);')
    const c = await connect()
    await c.query('create table hubs (id int)')
    const err = await migrate(c, { root, scopes: ['common'] }).catch((e) => e)
    expect(err.code).toBe('BASELINE_ON_EXISTING_DB')
    expect(await rows(c, `select to_regclass('${schema}.schema_migrations') is not null as t`)).toEqual([{ t: true }])
    expect(await rows(c, 'select count(*)::int as n from schema_migrations')).toEqual([{ n: 0 }])
  })

  it('--mark-applied는 실행하지 않고 기록만', async () => {
    put('common', '20261110000000_baseline.sql', 'create table hubs (id int);')
    put('common', '20261111000000_next.sql', 'create table nxt (id int);')
    const c = await connect()
    await c.query('create table hubs (id int, name text)') // 이미 있는 외부 DB
    const r = await migrate(c, { root, scopes: ['common'], markApplied: ['20261110000000'] })
    expect(r).toEqual({ marked: ['20261110000000'], applied: ['20261111000000'] })
    expect((await rows(c, `select count(*)::int as n from information_schema.columns where table_schema='${schema}' and table_name='hubs'`))[0].n).toBe(2)
  })

  it('--mark-applied에 없는 버전을 주면 아무것도 하지 않고 멈춘다', async () => {
    put('common', '20261110000000_a.sql', 'create table a (id int);')
    const c = await connect()
    const err = await migrate(c, { root, scopes: ['common'], markApplied: ['20991231000000'] }).catch((e) => e)
    expect(err.code).toBe('MARK_UNKNOWN_VERSION')
    expect(await exists(c, 'a')).toBe(false)
  })

  it('serializes concurrent runs', async () => {
    put('common', '20261110000000_a.sql', 'create table a (id int); select pg_sleep(0.3);')
    put('common', '20261111000000_b.sql', 'create table b (id int);')
    const [c1, c2] = [await connect(), await connect()]
    const [r1, r2] = await Promise.all([migrate(c1, { root, scopes: ['common'] }), migrate(c2, { root, scopes: ['common'] })])
    expect([...r1.applied, ...r2.applied].sort()).toEqual(['20261110000000', '20261111000000'])
  })

  it('같은 마이그레이션을 받은 두 DB(스키마)는 diff가 없다', async () => {
    put('common', '20261110000000_a.sql', `create table hubs (id uuid primary key default gen_random_uuid(), key text not null unique);
      create table mail_jobs (id bigserial primary key, hub_id uuid references hubs(id), subject text not null);
      create index idx_mail_jobs_hub on mail_jobs (hub_id);`)
    const a = await connect()
    await migrate(a, { root, scopes: ['common'] })
    const other = `${schema}_b`
    const admin = await connect()
    await admin.query(`create schema ${other}`)
    const b = new pg.Client({ connectionString: URL, options: `-c search_path=${other}` })
    await b.connect()
    clients.push(b)
    try {
      await migrate(b, { root, scopes: ['common'] })
      expect(diffSchemas(await describeSchema(a), await describeSchema(b))).toEqual([])
      await b.query('alter table mail_jobs alter column subject drop not null')
      expect(diffSchemas(await describeSchema(a), await describeSchema(b))).toEqual(['mail_jobs.subject: nullable NO ≠ YES'])
    } finally {
      await admin.query(`drop schema ${other} cascade`)
    }
  })

  it('트랜잭션을 끊는 문장이 든 파일이 있으면 아무것도 적용하지 않는다', async () => {
    put('common', '20261110000000_a.sql', 'create table a (id int);')
    put('common', '20261111000000_b.sql', 'select 1; commit; create table x (id int);')
    const c = await connect()
    const err = await migrate(c, { root, scopes: ['common'] }).catch((e) => e)
    expect(err.code).toBe('TX_CONTROL_IN_FILE')
    expect(await exists(c, 'a')).toBe(false)
    expect(await exists(c, 'x')).toBe(false)
  })

  it('status: applied·pending·mismatched·unknown', async () => {
    put('common', '20261110000000_a.sql', 'create table a (id int);')
    put('common', '20261111000000_b.sql', 'create table b (id int);')
    const c = await connect()
    await migrate(c, { root, scopes: ['common'] })
    await c.query(`insert into schema_migrations (version, scope, checksum) values ('20250101000000', 'common', 'x')`)
    put('common', '20261111000000_b.sql', 'create table b (id bigint);')
    put('common', '20261112000000_c.sql', 'create table c (id int);')
    const s = await status(c, { root, scopes: ['common'] })
    expect(s.map((x) => [x.version, x.state])).toEqual([
      ['20250101000000', 'unknown'], ['20261110000000', 'applied'], ['20261111000000', 'mismatched'], ['20261112000000', 'pending'],
    ])
  })
})
