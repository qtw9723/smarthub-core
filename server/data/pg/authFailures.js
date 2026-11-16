// 로그인 실패 기록 저장소(사내, pg).
import { query } from './pool.js'

export async function count(scope, client, sinceIso) {
  const { rows } = await query('select count(*)::int as n from auth_failures where scope = $1 and client = $2 and failed_at >= $3',
    [scope, client, sinceIso])
  return rows[0].n
}

export async function record(scope, client) {
  await query('insert into auth_failures (scope, client) values ($1, $2)', [scope, client])
}

export async function prune(beforeIso) {
  await query('delete from auth_failures where failed_at < $1', [beforeIso])
}
