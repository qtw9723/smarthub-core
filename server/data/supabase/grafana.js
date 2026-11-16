// Grafana 저장소(외부, supabase-js) — settings·sources·logTypes 모듈과 admin activity의 쿼리를 그대로 옮겼다.
// 매칭·마스킹·기본값 채우기 같은 도메인 로직은 각 모듈에 남는다.
import { supabaseClient } from './client.js'
import { toRepoError } from '../errors.js'

const SETTINGS = 'grafana_report_settings'
const SOURCES = 'grafana_sources'
const TYPES = 'grafana_log_types'
const RUNS = 'grafana_log_type_runs'
const ENTRIES = 'grafana_log_entries'

const db = () => supabaseClient()
const rows = ({ data, error }) => { if (error) throw toRepoError(error); return data ?? [] }
const first = ({ data, error }) => { if (error) throw toRepoError(error); return data?.[0] ?? null }
const maybe = ({ data, error }) => { if (error) throw toRepoError(error); return data ?? null }
const single = ({ data, error }) => { if (error) throw toRepoError(error); return data }
const done = ({ error }) => { if (error) throw toRepoError(error) }

export const settings = {
  getRow: async (hubId) => maybe(await db().from(SETTINGS).select('*').eq('hub_id', hubId).maybeSingle()),
  createRow: async (hubId) => single(await db().from(SETTINGS).insert({ hub_id: hubId }).select('*').single()),
  async update(hubId, patch) {
    const { data, error } = await db().from(SETTINGS).update(patch).eq('hub_id', hubId).select('*').single()
    if (error && error.code !== 'PGRST116') throw toRepoError(error)
    return data ?? null
  },
  listActivity: async () => rows(await db().from(SETTINGS).select('hub_id, last_analysis, last_analysis_date, last_sent_date')),
}

export const sources = {
  list: async (hubId) => rows(await db().from(SOURCES).select('*').eq('hub_id', hubId).order('sort_order', { ascending: true })),
  get: async (hubId, id) => maybe(await db().from(SOURCES).select('*').eq('hub_id', hubId).eq('id', id).maybeSingle()),
  first: async (hubId) => rows(await db().from(SOURCES).select('*').eq('hub_id', hubId).order('sort_order', { ascending: true }).limit(1))[0] ?? null,
  create: async (hubId, fields) => single(await db().from(SOURCES).insert({ hub_id: hubId, ...fields }).select('*').single()),
  update: async (hubId, id, fields) => first(await db().from(SOURCES).update(fields).eq('hub_id', hubId).eq('id', id).select('*')),
  async count(hubId) {
    const { count, error } = await db().from(SOURCES).select('id', { count: 'exact', head: true }).eq('hub_id', hubId)
    if (error) throw toRepoError(error)
    return count ?? 0
  },
  remove: async (hubId, id) => rows(await db().from(SOURCES).delete().eq('hub_id', hubId).eq('id', id).select('id')).length > 0,
}

export const types = {
  list: async (hubId, sourceId) => rows(await db().from(TYPES).select('*').eq('hub_id', hubId).eq('source_id', sourceId)
    .order('last_seen_at', { ascending: false, nullsFirst: false })),
  get: async (hubId, sourceId, id) => maybe(await db().from(TYPES).select('*').eq('id', id).eq('hub_id', hubId).eq('source_id', sourceId).maybeSingle()),
  insert: async (row) => single(await db().from(TYPES).insert(row).select('*').single()),
  update: async (id, patch) => first(await db().from(TYPES).update(patch).eq('id', id).select('*')),
  remove: async (id) => done(await db().from(TYPES).delete().eq('id', id)),
}

export const runs = {
  listForType: async (typeId, limit) => rows(await db().from(RUNS).select('*').eq('type_id', typeId).order('run_at', { ascending: false }).limit(limit)),
  listSince: async (typeIds, sinceIso) => rows(await db().from(RUNS).select('type_id, run_at, count')
    .in('type_id', typeIds).gte('run_at', sinceIso).order('run_at', { ascending: false })),
  async listOnDate(typeIds, runDate) {
    if (!typeIds.length) return []
    return rows(await db().from(RUNS).select('id, type_id, app, count').in('type_id', typeIds).eq('run_date', runDate))
  },
  get: async (id) => maybe(await db().from(RUNS).select('*').eq('id', id).maybeSingle()),
  insert: async (row) => single(await db().from(RUNS).insert(row).select('id').single()),
  update: async (id, patch) => first(await db().from(RUNS).update(patch).eq('id', id).select('*')),
}

export const entries = {
  listForType: async (typeId, limit) => rows(await db().from(ENTRIES).select('*').eq('type_id', typeId)
    .order('occurred_at', { ascending: false, nullsFirst: false }).limit(limit)),
  removeForRun: async (runId) => done(await db().from(ENTRIES).delete().eq('run_id', runId)),
  async insertMany(list) {
    if (!list.length) return
    done(await db().from(ENTRIES).insert(list))
  },
}
