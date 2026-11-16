// Grafana 저장소(사내, pg) — supabase 구현과 같은 함수·같은 결과(contract/grafana.db.test.js).
import { query } from './pool.js'
import { insertSql, setClause } from './sql.js'

const SETTINGS_COLS = ['hub_id', 'recipients', 'send_hour', 'enabled', 'last_sent_date', 'updated_at', 'log_lag_hours', 'metrics',
  'log_queries', 'last_analysis', 'last_analysis_date']
const SOURCE_COLS = ['hub_id', 'name', 'sort_order', 'base_url', 'token', 'prom_uid', 'es_uid', 'recipients', 'send_hour', 'enabled',
  'log_lag_hours', 'metrics', 'log_queries', 'last_analysis', 'last_analysis_date', 'last_sent_date', 'updated_at',
  'analysis_blocked_until', 'last_analysis_error', 'last_analysis_error_at']
const TYPE_COLS = ['hub_id', 'source_id', 'label', 'description', 'note', 'total_count', 'last_seen_at', 'updated_at', 'ai_note']
const RUN_COLS = ['type_id', 'run_at', 'run_date', 'app', 'count', 'logs', 'note', 'matched_by']
const ENTRY_COLS = ['type_id', 'run_id', 'app', 'occurred_at', 'msg']
// jsonb 컬럼은 문자열로 넘긴다(node-pg는 JS 배열을 Postgres 배열 리터럴로 바꾼다). settings.recipients는 text[]라 그대로.
const JSONB = {
  grafana_report_settings: ['metrics', 'log_queries', 'last_analysis'],
  grafana_sources: ['recipients', 'metrics', 'log_queries', 'last_analysis'],
  grafana_log_type_runs: ['logs'],
}
const enc = (table, row) => Object.fromEntries(Object.entries(row).map(([k, v]) =>
  [k, (JSONB[table] ?? []).includes(k) && v !== undefined && v !== null ? JSON.stringify(v) : v]))
const all = async (sql, params) => (await query(sql, params)).rows
const one = async (sql, params) => (await query(sql, params)).rows[0] ?? null
async function insertRow(table, row, cols, returning = '*') {
  const q = insertSql(table, enc(table, row), cols, returning)
  return (await query(q.text, q.values)).rows[0]
}
function updateRows(table, patch, cols, where, whereValues) {
  const set = setClause(enc(table, patch), cols, `${table} update`)
  const n = set.values.length
  return one(`update ${table} set ${set.text} where ${where.replace(/\$(\d+)/g, (_, i) => `$${n + Number(i)}`)} returning *`, [...set.values, ...whereValues])
}

export const settings = {
  getRow: (hubId) => one('select * from grafana_report_settings where hub_id = $1', [hubId]),
  createRow: (hubId) => insertRow('grafana_report_settings', { hub_id: hubId }, SETTINGS_COLS),
  update: (hubId, patch) => updateRows('grafana_report_settings', patch, SETTINGS_COLS, 'hub_id = $1', [hubId]),
  listActivity: () => all('select hub_id, last_analysis, last_analysis_date, last_sent_date from grafana_report_settings'),
}

export const sources = {
  list: (hubId) => all('select * from grafana_sources where hub_id = $1 order by sort_order asc', [hubId]),
  get: (hubId, id) => one('select * from grafana_sources where hub_id = $1 and id = $2', [hubId, id]),
  first: (hubId) => one('select * from grafana_sources where hub_id = $1 order by sort_order asc limit 1', [hubId]),
  create: (hubId, fields) => insertRow('grafana_sources', { hub_id: hubId, ...fields }, SOURCE_COLS),
  update: (hubId, id, fields) => updateRows('grafana_sources', fields, SOURCE_COLS, 'hub_id = $1 and id = $2', [hubId, id]),
  count: async (hubId) => (await one('select count(*)::int as n from grafana_sources where hub_id = $1', [hubId])).n,
  remove: async (hubId, id) => (await query('delete from grafana_sources where hub_id = $1 and id = $2', [hubId, id])).rowCount > 0,
}

export const types = {
  list: (hubId, sourceId) => all('select * from grafana_log_types where hub_id = $1 and source_id = $2 order by last_seen_at desc nulls last', [hubId, sourceId]),
  get: (hubId, sourceId, id) => one('select * from grafana_log_types where id = $1 and hub_id = $2 and source_id = $3', [id, hubId, sourceId]),
  insert: (row) => insertRow('grafana_log_types', row, TYPE_COLS),
  update: (id, patch) => updateRows('grafana_log_types', patch, TYPE_COLS, 'id = $1', [id]),
  remove: async (id) => { await query('delete from grafana_log_types where id = $1', [id]) },
}

export const runs = {
  listForType: (typeId, limit) => all('select * from grafana_log_type_runs where type_id = $1 order by run_at desc limit $2', [typeId, limit]),
  listSince: (typeIds, sinceIso) => all('select type_id, run_at, count from grafana_log_type_runs where type_id = any($1::uuid[]) and run_at >= $2 order by run_at desc',
    [typeIds, sinceIso]),
  async listOnDate(typeIds, runDate) {
    if (!typeIds.length) return []
    return all('select id, type_id, app, count from grafana_log_type_runs where type_id = any($1::uuid[]) and run_date = $2', [typeIds, runDate])
  },
  get: (id) => one('select * from grafana_log_type_runs where id = $1', [id]),
  insert: (row) => insertRow('grafana_log_type_runs', row, RUN_COLS, 'id'),
  update: (id, patch) => updateRows('grafana_log_type_runs', patch, RUN_COLS, 'id = $1', [id]),
}

export const entries = {
  listForType: (typeId, limit) => all('select * from grafana_log_entries where type_id = $1 order by occurred_at desc nulls last limit $2', [typeId, limit]),
  removeForRun: async (runId) => { await query('delete from grafana_log_entries where run_id = $1', [runId]) },
  async insertMany(list) {
    if (!list.length) return
    const cols = ENTRY_COLS
    const values = []
    const tuples = list.map((row, r) => {
      const bad = Object.keys(row).filter((k) => !cols.includes(k))
      if (bad.length) throw new Error(`grafana_log_entries: 허용되지 않은 컬럼 ${bad.join(', ')}`)
      cols.forEach((c) => values.push(row[c] ?? null))
      return `(${cols.map((_, i) => `$${r * cols.length + i + 1}`).join(', ')})`
    })
    await query(`insert into grafana_log_entries (${cols.join(', ')}) values ${tuples.join(', ')}`, values)
  },
}
