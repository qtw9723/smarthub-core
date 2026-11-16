// 챗봇 점검 기록 저장소(사내, pg).
import { query } from './pool.js'
import { insertSql } from './sql.js'

const COLS = ['chatbot_id', 'hub_id', 'ok', 'detail', 'duration_ms', 'checked_at', 'attempts']
const DEFAULT_COLS = ['chatbot_id', 'ok', 'detail', 'duration_ms', 'checked_at']

export async function listRecent(botIds, limit, cols = DEFAULT_COLS) {
  const bad = cols.filter((c) => !COLS.includes(c))
  if (bad.length) throw new Error(`checks.listRecent: 허용되지 않은 cols ${bad.join(', ')}`)
  if (!botIds.length) return []
  return (await query(`select ${cols.join(', ')} from hub_chatbot_check_log where chatbot_id = any($1::uuid[]) order by checked_at desc limit $2`,
    [botIds, limit])).rows
}

export async function listRecentEvents(limit) {
  return (await query('select chatbot_id, hub_id, ok, detail, checked_at from hub_chatbot_check_log order by checked_at desc limit $1', [limit])).rows
}

export async function insert(row) {
  const q = insertSql('hub_chatbot_check_log', row, COLS, 'id')
  await query(q.text, q.values)
}
