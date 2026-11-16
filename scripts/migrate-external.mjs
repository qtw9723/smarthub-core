#!/usr/bin/env node
// 외부 DB(Supabase) 마이그레이션 적용 — Management API로(외부 DB 접속 문자열 없이). 외부 DB 쓰기라 사용자가 직접 실행한다.
//
//   node scripts/migrate-external.mjs --dry-run     적용할 목록만
//   node scripts/migrate-external.mjs               미적용분(common+external)을 한 트랜잭션으로 적용 + schema_migrations 기록
//
// env: SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF(.env). 사내 DB는 배포 때 initContainer가 `node scripts/migrate.mjs`로 적용한다.
// 체크섬이 바뀐 파일이 있으면 아무것도 하지 않는다(러너와 같은 규칙).
import 'dotenv/config'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readMigrations, planMigrations, checksum } from './migrate/plan.mjs'
import { lintTransactionControl } from './migrate/lint.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../db/migrations')
const DRY = process.argv.includes('--dry-run')
const { SUPABASE_ACCESS_TOKEN: token, SUPABASE_PROJECT_REF: ref } = process.env
if (!token || !ref) { console.error('SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF가 없다(.env)'); process.exit(1) }

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'curl/8' },
    body: JSON.stringify({ query }),
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`${r.status} ${text.slice(0, 300)}`)
  return JSON.parse(text)
}
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`

const applied = await sql('select version, scope, checksum from schema_migrations')
const { pending, mismatched } = planMigrations(readMigrations(ROOT, ['common', 'external']), applied)
if (mismatched.length) { console.error(`이미 적용된 파일이 바뀌었다 — 멈춤: ${mismatched.map((m) => `${m.scope}/${m.version}`).join(', ')}`); process.exit(1) }
if (!pending.length) { console.log('적용할 것 없음'); process.exit(0) }
for (const m of pending) console.log(`${DRY ? 'pending ' : 'apply   '} ${m.scope}/${m.file}`)
const broken = pending.flatMap((m) => lintTransactionControl(m.sql).violations.map((v) => `${m.file}:${v.line} ${v.pattern}`))
if (broken.length) { console.error(`트랜잭션을 끊는 문장: ${broken.join(', ')}`); process.exit(1) }
if (DRY) process.exit(0)

const body = pending.map((m) => `-- ${m.scope}/${m.file}\n${m.sql.trim()}\n` +
  `insert into schema_migrations (version, scope, checksum) values (${lit(m.version)}, ${lit(m.scope)}, ${lit(checksum(m.sql))});`).join('\n')
await sql(`begin;\n${body}\ncommit;`)
console.log(`적용 ${pending.length}건(한 트랜잭션)`)
