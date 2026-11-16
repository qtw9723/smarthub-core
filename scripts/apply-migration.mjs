// Supabase Management API로 SQL 파일을 멱등 실행한다.
// `supabase db push` 금지 규약 준수 (히스토리 divergence 방지).
// 사용: node scripts/apply-migration.mjs <sql파일경로>
// 필요 env: SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF
import 'dotenv/config'
import { readFile } from 'node:fs/promises'

const token = process.env.SUPABASE_ACCESS_TOKEN
const ref = process.env.SUPABASE_PROJECT_REF
const file = process.argv[2]

if (!token || !ref) { console.error('SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF 필요'); process.exit(1) }
if (!file) { console.error('사용: node scripts/apply-migration.mjs <sql파일>'); process.exit(1) }

const query = await readFile(file, 'utf8')

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'curl/8',
  },
  body: JSON.stringify({ query }),
})

const text = await res.text()
if (!res.ok) { console.error(`실패 (${res.status}): ${text.slice(0, 500)}`); process.exit(1) }
console.log(`적용 완료: ${file}`)
console.log(text.slice(0, 500))
