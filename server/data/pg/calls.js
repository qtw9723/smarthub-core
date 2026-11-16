// 모듈 호출 기록 저장소(사내, pg).
import { query } from './pool.js'

export async function count(hubId, featureKey, sinceIso) {
  const { rows } = await query('select count(*)::int as n from hub_module_calls where hub_id = $1 and feature_key = $2 and called_at >= $3',
    [hubId, featureKey, sinceIso])
  return rows[0].n
}

export async function record(hubId, featureKey) {
  await query('insert into hub_module_calls (hub_id, feature_key) values ($1, $2)', [hubId, featureKey])
}
