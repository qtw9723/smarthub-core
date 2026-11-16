// 마이그레이션 러너 — 계획(plan.mjs)을 실제 DB에 적용하고 schema_migrations에 기록한다.
//
// 두 DB(외부 Supabase · 사내 자체 Postgres)에 같은 파일을 같은 순서로 적용하는 것이 목적이다.
// - 동시에 두 러너가 돌지 않게 advisory lock(롤링 배포에서 initContainer가 겹칠 수 있다).
// - 이미 적용된 파일이 바뀌었으면 아무것도 적용하지 않고 멈춘다(두 DB가 조용히 갈라지는 것을 막는다).
// - 파일마다 트랜잭션 — 실패한 파일만 되돌리고, 앞서 성공한 파일의 기록은 남긴다.
// - baseline(이름에 _baseline)은 빈 DB 전용이다. 테이블이 이미 있는 DB(외부)에는 --mark-applied로 기록만 한다.
import { readMigrations, planMigrations, checksum } from './plan.mjs'
import { OWNED_TABLES } from '../../db/ownedTables.mjs'
import { lintTransactionControl } from './lint.mjs'

const LOCK_KEY = 'smarthub_migrations'

export class MigrationError extends Error {
  constructor(code, message, details) {
    super(`${code}: ${message}`)
    this.code = code
    this.details = details
  }
}

/**
 * 세션 advisory lock을 쓰므로 Supabase transaction pooler(6543)는 거부한다 — 문장마다 다른 백엔드로 갈 수 있어
 * lock과 unlock이 엇갈리면 lock이 풀리지 않고 다음 실행이 끝없이 기다린다. 메시지에 접속 문자열을 담지 않는다.
 */
export function assertSessionConnection(connectionString) {
  let port
  try { port = new URL(connectionString).port } catch { return }
  if (port === '6543') {
    throw new MigrationError('TRANSACTION_POOLER', 'transaction pooler(6543)로는 마이그레이션을 돌리지 않는다 — Session pooler(5432)나 직접 접속 주소를 쓸 것')
  }
}

async function ensureTable(client) {
  await client.query(`create table if not exists schema_migrations (
    version text not null,
    scope text not null,
    checksum text not null,
    applied_at timestamptz not null default now(),
    primary key (version, scope)
  )`)
}

async function readApplied(client) {
  return (await client.query('select version, scope, checksum from schema_migrations')).rows
}

async function withLock(client, fn) {
  await client.query('select pg_advisory_lock(hashtext($1))', [LOCK_KEY])
  try {
    return await fn()
  } finally {
    await client.query('select pg_advisory_unlock(hashtext($1))', [LOCK_KEY])
  }
}

const record = (client, m) =>
  client.query('insert into schema_migrations (version, scope, checksum) values ($1, $2, $3)', [m.version, m.scope, checksum(m.sql)])

/**
 * @param {import('pg').Client} client
 * @param {{ root: string, scopes: string[], markApplied?: string[] }} opts
 * @returns {Promise<{ applied: string[], marked: string[] }>}
 */
export async function migrate(client, { root, scopes, markApplied = [] }) {
  return withLock(client, async () => {
    await ensureTable(client)
    const files = readMigrations(root, scopes)
    const { pending, mismatched } = planMigrations(files, await readApplied(client))
    if (mismatched.length) {
      throw new MigrationError('CHECKSUM_MISMATCH', `이미 적용된 파일이 바뀌었다 — 고치지 말고 새 마이그레이션을 만들 것: ${mismatched.map((m) => `${m.scope}/${m.version}`).join(', ')}`, mismatched)
    }
    const known = new Set(files.map((f) => f.version))
    const missing = markApplied.filter((v) => !known.has(v))
    if (missing.length) throw new MigrationError('MARK_UNKNOWN_VERSION', `기록할 파일이 없다: ${missing.join(', ')}`, missing)

    const toMark = pending.filter((m) => markApplied.includes(m.version))
    const toRun = pending.filter((m) => !markApplied.includes(m.version))

    const txBroken = toRun.flatMap((m) => lintTransactionControl(m.sql).violations.map((v) => `${m.scope}/${m.file}:${v.line} ${v.pattern}`))
    if (txBroken.length) {
      throw new MigrationError('TX_CONTROL_IN_FILE', `파일 안에서 트랜잭션을 끊는 문장은 쓰지 않는다(러너가 파일마다 트랜잭션을 연다): ${txBroken.join(', ')}`, txBroken)
    }

    if (toRun.some((m) => m.file.includes('_baseline'))) {
      const { rows } = await client.query('select to_regclass($1) is not null as present', [OWNED_TABLES[0]])
      if (rows[0].present) {
        throw new MigrationError('BASELINE_ON_EXISTING_DB', `${OWNED_TABLES[0]} 테이블이 이미 있다 — baseline은 빈 DB 전용. 기존 DB에는 --mark-applied로 기록만 할 것`)
      }
    }

    if (toMark.length) {
      await client.query('begin')
      try {
        for (const m of toMark) await record(client, m)
        await client.query('commit')
      } catch (e) {
        await client.query('rollback')
        throw e
      }
    }

    const applied = []
    for (const m of toRun) {
      await client.query('begin')
      try {
        await client.query(m.sql)
        await record(client, m)
        await client.query('commit')
      } catch (e) {
        await client.query('rollback')
        e.message = `${m.scope}/${m.file} 적용 실패: ${e.message}`
        throw e
      }
      applied.push(m.version)
    }
    return { applied, marked: toMark.map((m) => m.version) }
  })
}

/**
 * @returns {Promise<{ version: string, scope: string, state: 'applied'|'pending'|'mismatched'|'unknown' }[]>} 버전 순
 */
export async function status(client, { root, scopes }) {
  await ensureTable(client)
  const files = readMigrations(root, scopes)
  const applied = await readApplied(client)
  const { pending, mismatched, unknown } = planMigrations(files, applied)
  const stateOf = new Map()
  for (const f of files) stateOf.set(`${f.scope}/${f.version}`, 'applied')
  for (const m of pending) stateOf.set(`${m.scope}/${m.version}`, 'pending')
  for (const m of mismatched) stateOf.set(`${m.scope}/${m.version}`, 'mismatched')
  for (const m of unknown) stateOf.set(`${m.scope}/${m.version}`, 'unknown')
  return [...stateOf].map(([k, state]) => {
    const [scope, version] = k.split('/')
    return { version, scope, state }
  }).sort((a, b) => a.version.localeCompare(b.version))
}
