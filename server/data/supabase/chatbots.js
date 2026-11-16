// 챗봇 저장소(외부, supabase-js) — chatbot-monitoring 라우터·overview·admin·점검 스크립트의 쿼리를 그대로 옮겼다.
import { supabaseClient } from './client.js'
import { toRepoError } from '../errors.js'

const rows = ({ data, error }) => { if (error) throw toRepoError(error); return data ?? [] }
const first = ({ data, error }) => { if (error) throw toRepoError(error); return data?.[0] ?? null }
function oneOrNull({ data, error }) {
  if (error && error.code !== 'PGRST116') throw toRepoError(error)
  return data ?? null
}

export async function listBots(hubId) {
  return rows(await supabaseClient().from('hub_chatbots').select('*').eq('hub_id', hubId)
    .order('sort_order', { ascending: true }).order('created_at', { ascending: true }))
}

export async function listBotSummaries(hubId) {
  return rows(await supabaseClient().from('hub_chatbots').select('id, name, enabled, category').eq('hub_id', hubId))
}

export async function listAllBotNames() {
  return rows(await supabaseClient().from('hub_chatbots').select('id, hub_id, name'))
}

/** 점검 대상 — 켜진 봇. botId(단건)가 category보다 우선, category '__none__'은 미분류. */
export async function listEnabledBots(hubId, { botId, category } = {}) {
  let q = supabaseClient().from('hub_chatbots').select('*').eq('hub_id', hubId).eq('enabled', true)
  if (botId) q = q.eq('id', botId)
  else if (category) q = category === '__none__' ? q.is('category', null) : q.eq('category', category)
  return rows(await q)
}

export async function createBot(hubId, fields) {
  const { data, error } = await supabaseClient().from('hub_chatbots').insert({ hub_id: hubId, ...fields }).select().single()
  if (error) throw toRepoError(error)
  return data
}

export async function updateBot(hubId, id, patch) {
  return first(await supabaseClient().from('hub_chatbots').update(patch).eq('id', id).eq('hub_id', hubId).select())
}

export async function deleteBot(hubId, id) {
  return rows(await supabaseClient().from('hub_chatbots').delete().eq('id', id).eq('hub_id', hubId).select('id')).length > 0
}

export async function renameCategory(hubId, from, to) {
  const { error } = await supabaseClient().from('hub_chatbots').update({ category: to }).eq('hub_id', hubId).eq('category', from)
  if (error) throw toRepoError(error)
}

export async function getSettings(hubId) {
  return oneOrNull(await supabaseClient().from('hub_chatbot_settings').select('*').eq('hub_id', hubId).single())
}

export async function updateSettings(hubId, patch) {
  return oneOrNull(await supabaseClient().from('hub_chatbot_settings')
    .update({ ...patch, updated_at: new Date().toISOString() }).eq('hub_id', hubId).select().single())
}

/** 없으면 만든다(허브 생성 2단계). */
export async function ensureSettings(hubId) {
  const { error } = await supabaseClient().from('hub_chatbot_settings').upsert({ hub_id: hubId }, { onConflict: 'hub_id' })
  if (error) throw toRepoError(error)
}
