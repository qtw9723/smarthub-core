// 챗봇 저장소(사내, pg) — supabase 구현과 같은 함수·같은 결과(contract/chatbots.db.test.js).
import { query } from './pool.js'
import { insertSql, setClause } from './sql.js'

const BOT_COLS = ['hub_id', 'name', 'url', 'scenario', 'input_selector', 'category', 'enabled', 'sort_order']
const SETTINGS_COLS = ['recipients', 'categories', 'updated_at']
// jsonb 컬럼은 문자열로 넘긴다(node-pg는 JS 배열을 Postgres 배열 리터럴로 바꾼다).
const jsonb = (row, keys) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, keys.includes(k) && v !== undefined ? JSON.stringify(v) : v]))
const all = async (sql, params) => (await query(sql, params)).rows
const one = async (sql, params) => (await query(sql, params)).rows[0] ?? null

export const listBots = (hubId) => all('select * from hub_chatbots where hub_id = $1 order by sort_order asc, created_at asc', [hubId])
export const listBotSummaries = (hubId) => all('select id, name, enabled, category from hub_chatbots where hub_id = $1', [hubId])
export const listAllBotNames = () => all('select id, hub_id, name from hub_chatbots')

export function listEnabledBots(hubId, { botId, category } = {}) {
  if (botId) return all('select * from hub_chatbots where hub_id = $1 and enabled = true and id = $2', [hubId, botId])
  if (category === '__none__') return all('select * from hub_chatbots where hub_id = $1 and enabled = true and category is null', [hubId])
  if (category) return all('select * from hub_chatbots where hub_id = $1 and enabled = true and category = $2', [hubId, category])
  return all('select * from hub_chatbots where hub_id = $1 and enabled = true', [hubId])
}

export async function createBot(hubId, fields) {
  const q = insertSql('hub_chatbots', jsonb({ hub_id: hubId, ...fields }, ['scenario']), BOT_COLS)
  return (await query(q.text, q.values)).rows[0]
}

export function updateBot(hubId, id, patch) {
  const set = setClause(jsonb(patch, ['scenario']), BOT_COLS, 'updateBot')
  const n = set.values.length
  return one(`update hub_chatbots set ${set.text} where id = $${n + 1} and hub_id = $${n + 2} returning *`, [...set.values, id, hubId])
}

export const deleteBot = async (hubId, id) => (await query('delete from hub_chatbots where id = $1 and hub_id = $2', [id, hubId])).rowCount > 0

export async function renameCategory(hubId, from, to) {
  await query('update hub_chatbots set category = $1 where hub_id = $2 and category = $3', [to, hubId, from])
}

export const getSettings = (hubId) => one('select * from hub_chatbot_settings where hub_id = $1', [hubId])

export function updateSettings(hubId, patch) {
  const set = setClause(jsonb({ ...patch, updated_at: new Date().toISOString() }, ['recipients', 'categories']), SETTINGS_COLS, 'updateSettings')
  return one(`update hub_chatbot_settings set ${set.text} where hub_id = $${set.values.length + 1} returning *`, [...set.values, hubId])
}

export async function ensureSettings(hubId) {
  await query('insert into hub_chatbot_settings (hub_id) values ($1) on conflict (hub_id) do nothing', [hubId])
}
