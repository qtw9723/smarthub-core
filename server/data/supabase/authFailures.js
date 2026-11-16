// 로그인 실패 기록 저장소(외부, supabase-js) — lib/authThrottle.js가 쓴다. 실패는 throw(호출자가 처리).
import { supabaseClient } from './client.js'
import { toRepoError } from '../errors.js'

export async function count(scope, client, sinceIso) {
  const { count: n, error } = await supabaseClient()
    .from('auth_failures').select('id', { count: 'exact', head: true })
    .eq('scope', scope).eq('client', client).gte('failed_at', sinceIso)
  if (error) throw toRepoError(error)
  return n ?? 0
}

export async function record(scope, client) {
  const { error } = await supabaseClient().from('auth_failures').insert({ scope, client })
  if (error) throw toRepoError(error)
}

export async function prune(beforeIso) {
  const { error } = await supabaseClient().from('auth_failures').delete().lt('failed_at', beforeIso)
  if (error) throw toRepoError(error)
}
