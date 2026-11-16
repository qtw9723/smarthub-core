// 허브 기능(모듈 켜기) 저장소(외부, supabase-js) — hubFeature·hubs·admin 라우트의 쿼리를 그대로 옮겼다.
import { supabaseClient } from './client.js'
import { toRepoError } from '../errors.js'

const PATCH = ['enabled', 'config', 'sort_order']
const list = ({ data, error }) => { if (error) throw toRepoError(error); return data ?? [] }

export async function getFeature(hubId, featureKey) {
  const { data, error } = await supabaseClient()
    .from('hub_features').select('enabled').eq('hub_id', hubId).eq('feature_key', featureKey).maybeSingle()
  if (error) throw toRepoError(error)
  return data ?? null
}

export async function listPublic(hubId) {
  return list(await supabaseClient()
    .from('hub_features').select('feature_key, enabled, sort_order').eq('hub_id', hubId).order('sort_order', { ascending: true }))
}

export async function listAdmin(hubId) {
  return list(await supabaseClient()
    .from('hub_features').select('feature_key, enabled, config, sort_order').eq('hub_id', hubId).order('sort_order', { ascending: true }))
}

export async function listAllFlags() {
  return list(await supabaseClient().from('hub_features').select('hub_id, feature_key, enabled'))
}

export async function upsert(hubId, featureKey, patch) {
  const bad = Object.keys(patch).filter((k) => !PATCH.includes(k))
  if (bad.length) throw new Error(`features.upsert: 허용되지 않은 컬럼 ${bad.join(', ')}`)
  const { data, error } = await supabaseClient()
    .from('hub_features').upsert({ hub_id: hubId, feature_key: featureKey, ...patch }, { onConflict: 'hub_id,feature_key' }).select().single()
  if (error) throw toRepoError(error)
  return data
}
