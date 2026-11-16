// 허브 기능 저장소(사내, pg) — supabase 구현과 같은 함수·같은 결과(contract/hubs.db.test.js).
import { query } from './pool.js'
import { assertColumns } from './sql.js'

const PATCH = ['enabled', 'config', 'sort_order']

export async function getFeature(hubId, featureKey) {
  return (await query('select enabled from hub_features where hub_id = $1 and feature_key = $2', [hubId, featureKey])).rows[0] ?? null
}

export async function listPublic(hubId) {
  return (await query('select feature_key, enabled, sort_order from hub_features where hub_id = $1 order by sort_order asc', [hubId])).rows
}

export async function listAdmin(hubId) {
  return (await query('select feature_key, enabled, config, sort_order from hub_features where hub_id = $1 order by sort_order asc', [hubId])).rows
}

export async function listAllFlags() {
  return (await query('select hub_id, feature_key, enabled from hub_features')).rows
}

/** 있으면 patch에 든 컬럼만 바꾸고, 없으면 만든다(PostgREST merge-duplicates와 같은 의미). */
export async function upsert(hubId, featureKey, patch) {
  const keys = Object.keys(patch).filter((k) => patch[k] !== undefined)
  assertColumns(keys, PATCH, 'features.upsert')
  const cols = ['hub_id', 'feature_key', ...keys]
  const values = [hubId, featureKey, ...keys.map((k) => (k === 'config' ? JSON.stringify(patch[k]) : patch[k]))]
  const update = keys.length ? keys.map((k) => `${k} = excluded.${k}`).join(', ') : 'hub_id = excluded.hub_id'
  const sql = `insert into hub_features (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})
    on conflict (hub_id, feature_key) do update set ${update} returning *`
  return (await query(sql, values)).rows[0]
}
