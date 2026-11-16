// 챗봇 점검 기록 저장소(외부, supabase-js).
import { supabaseClient } from './client.js'
import { toRepoError } from '../errors.js'

const COLS = ['chatbot_id', 'hub_id', 'ok', 'detail', 'duration_ms', 'checked_at', 'attempts']
const DEFAULT_COLS = ['chatbot_id', 'ok', 'detail', 'duration_ms', 'checked_at']
const rows = ({ data, error }) => { if (error) throw toRepoError(error); return data ?? [] }

export async function listRecent(botIds, limit, cols = DEFAULT_COLS) {
  const bad = cols.filter((c) => !COLS.includes(c))
  if (bad.length) throw new Error(`checks.listRecent: 허용되지 않은 cols ${bad.join(', ')}`)
  if (!botIds.length) return []
  return rows(await supabaseClient().from('hub_chatbot_check_log').select(cols.join(', '))
    .in('chatbot_id', botIds).order('checked_at', { ascending: false }).limit(limit))
}

export async function listRecentEvents(limit) {
  return rows(await supabaseClient().from('hub_chatbot_check_log').select('chatbot_id, hub_id, ok, detail, checked_at')
    .order('checked_at', { ascending: false }).limit(limit))
}

export async function insert(row) {
  const { error } = await supabaseClient().from('hub_chatbot_check_log').insert(row)
  if (error) throw toRepoError(error)
}
