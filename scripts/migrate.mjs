#!/usr/bin/env node
// 마이그레이션 적용 CLI — db/migrations/{common,external}을 DATABASE_URL의 DB에 적용한다. 규칙: db/README.md
//
//   npm run migrate                              미적용분 적용 (사내=common, 외부=common+external)
//   npm run migrate -- --status                  적용 상태 표 (적용하지 않음)
//   npm run migrate -- --dry-run                 적용할 목록만
//   npm run migrate -- --mark-applied <v,...>    실행하지 않고 기록만 (외부 DB에 baseline 편입할 때)
//   npm run migrate -- --scopes common           scope 직접 지정
//   npm run migrate -- --diff                    DATABASE_URL(A)와 DIFF_DATABASE_URL(B)의 소유 테이블 스키마 비교
//
// 기본 scope: SMARTHUB_EDITION=internal이면 common, 아니면 common,external.
// 접속 문자열은 출력하지 않는다(비밀번호가 들어 있다).
import 'dotenv/config'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import pg from 'pg'
import { migrate, status, assertSessionConnection } from './migrate/runner.mjs'
import { readMigrations, planMigrations } from './migrate/plan.mjs'
import { describeSchema, diffSchemas } from './migrate/diff.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../db/migrations')
const SCOPES = ['common', 'external']

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const value = (name) => {
  const i = args.indexOf(name)
  if (i < 0) return null
  if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`${name} 다음에 값이 필요하다`)
  return args[i + 1]
}

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL이 없다')
  const scopes = (value('--scopes') ?? (process.env.SMARTHUB_EDITION === 'internal' ? 'common' : 'common,external')).split(',')
  const bad = scopes.filter((s) => !SCOPES.includes(s))
  if (bad.length) throw new Error(`모르는 scope: ${bad.join(', ')} (가능: ${SCOPES.join(', ')})`)
  const markApplied = value('--mark-applied')?.split(',') ?? []

  if (flag('--diff')) {
    if (!process.env.DIFF_DATABASE_URL) throw new Error('DIFF_DATABASE_URL이 없다')
    const snap = async (connectionString) => {
      const c = new pg.Client({ connectionString })
      await c.connect()
      try { return await describeSchema(c) } finally { await c.end() }
    }
    const [a, b] = [await snap(url), await snap(process.env.DIFF_DATABASE_URL)]
    // 양쪽 다 소유 테이블이 없으면 비교한 것이 없다 — "차이 없음"으로 통과시키지 않는다.
    if (!a.tables.length || !b.tables.length) throw new Error(`소유 테이블이 없는 DB가 있다(A ${a.tables.length}개 · B ${b.tables.length}개) — 접속 대상을 확인할 것`)
    const lines = diffSchemas(a, b)
    console.log(lines.length ? lines.join('\n') : '차이 없음 (소유 테이블 컬럼·인덱스·제약, RLS 제외)')
    if (lines.length) process.exitCode = 1
    return
  }

  assertSessionConnection(url)
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    console.log(`scopes: ${scopes.join(',')}`)
    if (flag('--status')) {
      const rows = await status(client, { root: ROOT, scopes })
      for (const r of rows) console.log(`${r.state.padEnd(10)} ${r.scope.padEnd(8)} ${r.version}`)
      if (rows.some((r) => r.state === 'mismatched')) process.exitCode = 1
      return
    }
    if (flag('--dry-run')) {
      const applied = (await client.query('select version, scope, checksum from schema_migrations').catch(() => ({ rows: [] }))).rows
      const plan = planMigrations(readMigrations(ROOT, scopes), applied)
      for (const m of plan.pending) console.log(`pending   ${m.scope}/${m.file}${markApplied.includes(m.version) ? ' (기록만)' : ''}`)
      for (const m of plan.mismatched) console.log(`MISMATCH  ${m.scope}/${m.version}`)
      return
    }
    const r = await migrate(client, { root: ROOT, scopes, markApplied })
    for (const v of r.marked) console.log(`marked ${v}`)
    for (const v of r.applied) console.log(`applied ${v}`)
    console.log(`applied ${r.applied.length}`)
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
