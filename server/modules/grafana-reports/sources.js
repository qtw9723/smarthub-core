// server/modules/grafana-reports/sources.js
// grafana_sources를 hub_id로 스코프. 환경(소스) 1개=1행. token은 응답에서 마스킹.
// 연결 컬럼이 비면 client.js가 ENV로 폴백 → 기존 CS 무중단.
import { repos } from '../../data/index.js'
import { withQueryDefaults } from './config.js'

const MASK = '••••••••'
const ALLOWED = ['name', 'sort_order', 'base_url', 'token', 'prom_uid', 'es_uid', 'recipients',
  'send_hour', 'enabled', 'log_lag_hours', 'metrics', 'log_queries', 'last_analysis',
  'last_analysis_date', 'last_sent_date', 'analysis_blocked_until',
  'last_analysis_error', 'last_analysis_error_at']

// 토큰 마스킹: 빈 값은 빈 문자열, 그 외 앞 4자 + 마스크. 원문 길이는 노출하지 않는다.
export function maskToken(t) {
  const s = String(t ?? '')
  if (!s) return ''
  return s.slice(0, 4) + MASK
}

// 응답용: 토큰 마스킹 + metrics/log_queries 기본값 채움.
// 분석 실패 사유 원문은 DB에만 둔다 — 공개 허브에서도 /sources가 열리고, 원문엔
// 엔드포인트·쿼터 정보가 들어 있다. 시각(last_analysis_error_at)은 무해하므로 남긴다.
function masked(row) {
  if (!row) return row
  const { last_analysis_error: _omit, ...rest } = row
  return withQueryDefaults({ ...rest, token: maskToken(row.token) })
}

// 목록(정렬순, 토큰 마스킹).
export async function listSources(hubId) {
  return (await repos.grafana.sources.list(hubId)).map(masked)
}

// 원문 목록(tick 순회용 — 연결 필요). 정렬순, 마스킹 없음(클라이언트로 나가지 않음).
export async function listSourcesRaw(hubId) {
  return (await repos.grafana.sources.list(hubId)).map((r) => withQueryDefaults(r))
}

// 원문 토큰 포함(서버 내부 조회·tick·report/analyze용). 타 허브면 null.
export async function getSourceRaw(hubId, id) {
  const data = await repos.grafana.sources.get(hubId, id)
  return data ? withQueryDefaults(data) : null
}

// 마스킹 포함(클라이언트 응답용).
export async function getSource(hubId, id) {
  const raw = await getSourceRaw(hubId, id)
  return raw ? masked(raw) : null
}

// 정렬순 첫 소스(원문 — source 미지정 폴백/내부 조회용). 없으면 null.
export async function firstSource(hubId) {
  const data = await repos.grafana.sources.first(hubId)
  return data ? withQueryDefaults(data) : null
}

export async function createSource(hubId, fields) {
  const insert = {}
  for (const k of ALLOWED) if (fields[k] !== undefined) insert[k] = fields[k]
  return masked(await repos.grafana.sources.create(hubId, insert))
}

// 소유 검증(getSourceRaw) 통과 후에만 갱신. 빈/마스킹 token은 변경하지 않음(기존 유지).
export async function updateSource(hubId, id, fields) {
  const owned = await getSourceRaw(hubId, id)
  if (!owned) return null
  const update = { updated_at: new Date().toISOString() }
  for (const k of ALLOWED) if (fields[k] !== undefined) update[k] = fields[k]
  if (update.token !== undefined && (update.token === '' || String(update.token).endsWith(MASK))) {
    delete update.token
  }
  const data = await repos.grafana.sources.update(hubId, id, update)
  return data ? masked(data) : null
}

// 마지막 1개 소스는 삭제 불가(최소 1환경 보장). 타 허브/없음이면 not-found.
export async function deleteSource(hubId, id) {
  if ((await repos.grafana.sources.count(hubId)) <= 1) return { error: 'last-source' }
  if (!(await repos.grafana.sources.remove(hubId, id))) return { error: 'not-found' }
  return { ok: true }
}
