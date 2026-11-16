// 허브 저장소(외부, supabase-js) — admin·hubs 라우트, hubAuth·hubFeature, 모듈 resolveHubId에 있던 쿼리를 그대로 옮겼다.
// .single()은 행이 없으면 PGRST116 오류를 준다 — 저장소 규약대로 null로 바꾼다.
import { supabaseClient } from './client.js'
import { toRepoError } from '../errors.js'

const HUB_PATCH = ['name', 'enabled', 'sort_order']
const isUuid = (v) => /^[0-9a-f-]{36}$/i.test(v)

function oneOrNull({ data, error }) {
  if (error && error.code !== 'PGRST116') throw toRepoError(error)
  return data ?? null
}
function firstOrNull({ data, error }) {
  if (error) throw toRepoError(error)
  return data?.[0] ?? null
}

export async function getHubByKey(key) {
  return oneOrNull(await supabaseClient().from('hubs').select('*').eq('key', key).single())
}

export async function getHubId(key) {
  return oneOrNull(await supabaseClient().from('hubs').select('id').eq('key', key).single())?.id ?? null
}

export async function getHubByIdOrKey(idOrKey) {
  return oneOrNull(await supabaseClient().from('hubs').select('*').eq(isUuid(idOrKey) ? 'id' : 'key', idOrKey).single())
}

export async function listHubs() {
  const { data, error } = await supabaseClient()
    .from('hubs').select('*').order('sort_order', { ascending: true }).order('created_at', { ascending: true })
  if (error) throw toRepoError(error)
  return data ?? []
}

export async function listHubIdNames() {
  const { data, error } = await supabaseClient().from('hubs').select('id, key, name')
  if (error) throw toRepoError(error)
  return data ?? []
}

export async function createHub(row) {
  const { data, error } = await supabaseClient().from('hubs').insert(row).select().single()
  if (error) throw toRepoError(error)
  return data
}

export async function updateHub(id, patch) {
  const bad = Object.keys(patch).filter((k) => !HUB_PATCH.includes(k))
  if (bad.length) throw new Error(`updateHub: 허용되지 않은 컬럼 ${bad.join(', ')}`)
  return firstOrNull(await supabaseClient().from('hubs').update(patch).eq('id', id).select())
}

export async function setPasswordHash(id, passwordHash) {
  return firstOrNull(await supabaseClient().from('hubs').update({ password_hash: passwordHash }).eq('id', id).select())
}

export async function setSecurityAck(id, level) {
  return firstOrNull(await supabaseClient().from('hubs').update({ security_ack_level: level }).eq('id', id).select())
}

export async function deleteHub(id) {
  const { data, error } = await supabaseClient().from('hubs').delete().eq('id', id).select()
  if (error) throw toRepoError(error)
  return (data ?? []).length > 0
}
