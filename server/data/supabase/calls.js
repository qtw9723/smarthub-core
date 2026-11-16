// 모듈 호출 기록 저장소(외부, supabase-js) — hubCallLimit의 쿼리를 그대로 옮겼다. 실패는 throw(호출자가 503, fail-closed).
import { supabaseClient } from './client.js'
import { toRepoError } from '../errors.js'

export async function count(hubId, featureKey, sinceIso) {
  const { count: n, error } = await supabaseClient()
    .from('hub_module_calls').select('id', { count: 'exact', head: true })
    .eq('hub_id', hubId).eq('feature_key', featureKey).gte('called_at', sinceIso)
  if (error) throw toRepoError(error)
  return n ?? 0
}

export async function record(hubId, featureKey) {
  const { error } = await supabaseClient().from('hub_module_calls').insert({ hub_id: hubId, feature_key: featureKey })
  if (error) throw toRepoError(error)
}
