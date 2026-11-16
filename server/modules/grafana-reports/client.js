// server/modules/grafana-reports/client.js
// 소스(환경) 주입형 Grafana 조회. 소스의 연결 컬럼이 비면 ENV로 폴백 → 기존 CS 무중단.
import { LOG_HOURS, LOG_FETCH, LOG_INDEX_LAG_HOURS, activeQueries } from './config.js'
import { extractPromValue, normalizeEsIndex, parseEsResponses, esLogRange } from './report.js'

const TIMEOUT = 30000

// 소스 값 우선, 없으면 ENV 폴백. url 끝 '/' 제거. url/token 둘 중 하나라도 없으면 예외.
export function resolveConn(source) {
  const url = (source?.base_url || process.env.GRAFANA_URL || '').replace(/\/$/, '')
  const token = source?.token || process.env.GRAFANA_TOKEN || ''
  const promUid = source?.prom_uid || process.env.PROM_UID || ''
  const esUid = source?.es_uid || process.env.ES_UID || ''
  if (!url || !token) throw new Error('Grafana 연결정보 미설정(소스/ENV 모두 없음)')
  return { url, token, promUid, esUid }
}

function headers(token, extra = {}) {
  return { Authorization: `Bearer ${token}`, ...extra }
}

export async function queryPrometheus(source, expr) {
  const { url, token, promUid } = resolveConn(source)
  const body = {
    from: 'now-5m', to: 'now',
    queries: [{ refId: 'A', datasource: { uid: promUid }, expr, instant: true }],
  }
  const r = await fetch(`${url}/api/ds/query`, {
    method: 'POST',
    headers: headers(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT),
  })
  if (!r.ok) throw new Error(`prometheus ${r.status}`)
  return extractPromValue(await r.json())
}

export async function getEsIndexAndTimeField(source, uid) {
  const { url, token } = resolveConn(source)
  const r = await fetch(`${url}/api/datasources/uid/${uid}`, {
    headers: headers(token), signal: AbortSignal.timeout(TIMEOUT),
  })
  if (!r.ok) throw new Error(`es datasource ${r.status}`)
  const ds = await r.json()
  const jd = ds.jsonData || {}
  return {
    index: normalizeEsIndex(jd.index || ds.database || '*'),
    timefield: jd.timeField || '@timestamp',
  }
}

export async function queryElasticsearch(source, queries, hours, fetchSize, lagHours = 0) {
  const { url, token, esUid } = resolveConn(source)
  const { index, timefield } = await getEsIndexAndTimeField(source, esUid)
  const range = esLogRange(hours, lagHours)
  const nd = []
  for (const lq of queries) {
    nd.push(JSON.stringify({ index, ignore_unavailable: true }))
    nd.push(JSON.stringify({
      size: fetchSize,
      track_total_hits: true,
      sort: [{ [timefield]: { order: 'desc' } }],
      query: { bool: {
        must: [{ query_string: { query: lq.query } }],
        filter: [{ range: { [timefield]: range } }],
      } },
    }))
  }
  const payload = nd.join('\n') + '\n'
  const r = await fetch(`${url}/api/datasources/proxy/uid/${esUid}/_msearch`, {
    method: 'POST',
    headers: headers(token, { 'Content-Type': 'application/x-ndjson' }),
    body: payload,
    signal: AbortSignal.timeout(TIMEOUT),
  })
  if (!r.ok) throw new Error(`elasticsearch ${r.status}`)
  const json = await r.json()
  return parseEsResponses(json.responses || [], queries, timefield)
}

// 메트릭/로그를 모두 조회해 buildReport 입력 형태로 반환. 비활성 항목 제외, 개별 실패는 격리.
export async function gatherReportData(source, metrics, logQueries, lagHours = LOG_INDEX_LAG_HOURS) {
  const activeMetrics = activeQueries(metrics)
  const m = await Promise.all(activeMetrics.map(async (mt) => {
    try {
      const value = await queryPrometheus(source, mt.query)
      return { label: mt.label, value, threshold: mt.threshold, error: value == null ? '데이터 없음' : null }
    } catch {
      return { label: mt.label, value: null, threshold: mt.threshold, error: '조회 실패' }
    }
  }))

  const activeLogs = activeQueries(logQueries)
  let logs
  try {
    // 활성 로그 쿼리가 없으면 _msearch 호출을 건너뛴다(빈 요청 방지). 메트릭 경로(Promise.all([]))와 대칭.
    const res = activeLogs.length ? await queryElasticsearch(source, activeLogs, LOG_HOURS, LOG_FETCH, lagHours) : {}
    logs = activeLogs.map((lq) => ({
      app: lq.label,
      count: res[lq.label]?.count ?? 0,
      rows: res[lq.label]?.rows ?? [],
      error: null,
    }))
  } catch {
    logs = activeLogs.map((lq) => ({ app: lq.label, count: 0, rows: [], error: '조회 실패' }))
  }

  return { metrics: m, logs }
}
