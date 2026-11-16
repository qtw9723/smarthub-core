// 앱 설정 저장소(외부, supabase-js) — app_settings(key·value).
import { supabaseClient } from './client.js'
import { toRepoError } from '../errors.js'

export async function get(key) {
  const { data, error } = await supabaseClient().from('app_settings').select('value').eq('key', key).maybeSingle()
  if (error) throw toRepoError(error)
  return data?.value ?? null
}

export async function set(key, value) {
  const { error } = await supabaseClient().from('app_settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) throw toRepoError(error)
}

export async function remove(key) {
  const { error } = await supabaseClient().from('app_settings').delete().eq('key', key)
  if (error) throw toRepoError(error)
}
