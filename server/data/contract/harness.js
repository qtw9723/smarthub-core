// 저장소 계약 테스트 하네스 — 같은 시나리오를 두 구현에 돌린다.
//   · pg       : 테스트 Postgres의 contract DB에 직접
//   · supabase : 같은 DB 앞의 PostgREST(supabase-js가 실제로 말하는 서버)를 거쳐서
// 그래서 두 구현 모두 진짜 DB 의미(정렬 NULLS LAST, jsonb 포함, 23505 …)로 검증된다. 실행법: README.md
//
// env: TEST_DATABASE_URL(…/postgres), TEST_POSTGREST_URL(기본 http://localhost:3300),
//      TEST_POSTGREST_JWT_SECRET(PostgREST의 PGRST_JWT_SECRET과 같은 값). 없으면 실패한다(건너뛰지 않는다).
import { describe, beforeAll, beforeEach, afterAll } from 'vitest'
import { createServer, request } from 'node:http'
import { createHmac } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import { migrate } from '../../../scripts/migrate/runner.mjs'
import { OWNED_TABLES } from '../../../db/ownedTables.mjs'

const MIGRATIONS = resolve(dirname(fileURLToPath(import.meta.url)), '../../../db/migrations')
const BASE_URL = process.env.TEST_DATABASE_URL
const PGRST = process.env.TEST_POSTGREST_URL ?? 'http://localhost:3300'
const SECRET = process.env.TEST_POSTGREST_JWT_SECRET ?? 'smarthub-contract-test-secret-0123456789abcdef'

const contractUrl = () => {
  const u = new URL(BASE_URL)
  u.pathname = '/contract'
  return u.toString()
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
function serviceJwt() {
  const head = b64({ alg: 'HS256', typ: 'JWT' })
  const body = b64({ role: 'postgres', exp: Math.floor(Date.now() / 1000) + 3600 })
  return `${head}.${body}.${createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url')}`
}

// supabase-js는 `${url}/rest/v1/<table>`로 부른다 — 접두사를 떼고 PostgREST로 넘긴다.
function startProxy() {
  const target = new URL(PGRST)
  const server = createServer((req, res) => {
    const path = req.url.replace(/^\/rest\/v1/, '') || '/'
    const up = request({ hostname: target.hostname, port: target.port, path, method: req.method, headers: { ...req.headers, host: target.host } }, (r) => {
      res.writeHead(r.statusCode, r.headers)
      r.pipe(res)
    })
    up.on('error', (e) => { res.writeHead(502); res.end(String(e)) })
    req.pipe(up)
  })
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)))
}

let shared = null
async function setup() {
  if (shared) return shared
  if (!BASE_URL) throw new Error('TEST_DATABASE_URL이 없다 — 계약 테스트는 건너뛰지 않는다(server/data/contract/README.md)')
  const admin = new pg.Client({ connectionString: BASE_URL })
  await admin.connect()
  const { rows } = await admin.query("select 1 from pg_database where datname = 'contract'")
  if (!rows.length) await admin.query('create database contract')
  await admin.end()

  const client = new pg.Client({ connectionString: contractUrl() })
  await client.connect()
  await migrate(client, { root: MIGRATIONS, scopes: ['common'] })
  await client.query("notify pgrst, 'reload schema'")

  const proxy = await startProxy()
  const proxyUrl = `http://127.0.0.1:${proxy.address().port}`
  const supa = createClient(proxyUrl, serviceJwt(), { auth: { persistSession: false, autoRefreshToken: false } })
  // PostgREST가 새 스키마를 읽을 때까지 기다린다.
  for (let i = 0; i < 150; i++) {
    const { error } = await supa.from('hubs').select('id').limit(1)
    if (!error) break
    if (i === 149) throw new Error(`PostgREST가 hubs를 못 본다(${PGRST}): ${error.message}`)
    await new Promise((r) => setTimeout(r, 200))
  }

  const { resetPoolForTest } = await import('../pg/pool.js')
  await resetPoolForTest(contractUrl())
  const { setSupabaseClientForTest } = await import('../supabase/client.js')
  setSupabaseClientForTest(supa)
  const pgRepos = (await import('../pg/index.js')).repos
  const supaRepos = (await import('../supabase/index.js')).repos
  shared = { client, proxy, pgRepos, supaRepos }
  return shared
}

/**
 * @param {string} name
 * @param {(ctx: { repos: () => any, sql: (text: string, params?: any[]) => Promise<any[]> }) => void} scenario
 */
export function contractSuite(name, scenario) {
  for (const impl of ['pg', 'supabase']) {
    describe(`${name} · ${impl}`, () => {
      let s
      beforeAll(async () => { s = await setup() })
      beforeEach(async () => {
        await s.client.query(`truncate ${OWNED_TABLES.join(', ')} restart identity cascade`)
      })
      afterAll(async () => {})
      scenario({
        repos: () => (impl === 'pg' ? s.pgRepos : s.supaRepos),
        sql: async (text, params) => (await s.client.query(text, params)).rows,
      })
    })
  }
}
