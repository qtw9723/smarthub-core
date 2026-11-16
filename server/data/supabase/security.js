// 모듈 보안 레벨 저장소(외부, supabase-js) — admin 라우트의 쿼리를 그대로 옮겼다.
import { supabaseClient } from './client.js'
import { toRepoError } from '../errors.js'

export async function list() {
  const { data, error } = await supabaseClient().from('hub_module_security').select('module_key, level, reason, updated_at')
  if (error) throw toRepoError(error)
  return data ?? []
}

export async function upsert(row) {
  const { error } = await supabaseClient().from('hub_module_security').upsert(row, { onConflict: 'module_key' })
  if (error) throw toRepoError(error)
}

export async function remove(moduleKey) {
  const { error } = await supabaseClient().from('hub_module_security').delete().eq('module_key', moduleKey)
  if (error) throw toRepoError(error)
}
