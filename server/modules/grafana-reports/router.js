// server/modules/grafana-reports/router.js
// Grafana 리포트 모듈 API. hub + source(환경) 스코프.
// 한 허브가 여러 Grafana 환경(소스)을 독립 모니터링 — 각 소스가 연결·쿼리·메일·오류를 따로 가진다.
import { Router } from 'express'
import { requireHubAccess } from '../../lib/hubAuth.js'
import { isUuid, isIntId } from '../../lib/ids.js'
import { guardAsyncRouter, finalizeAsyncRouter } from '../../lib/asyncRoute.js'
import { gatherReportData, queryPrometheus, queryElasticsearch, resolveConn } from './client.js'
import { buildReport, buildEmailHtml, combineLogQueries, grafanaLogExploreUrl } from './report.js'
import {
  listSources, listSourcesRaw, getSourceRaw, firstSource,
  createSource, updateSource, deleteSource, maskToken,
} from './sources.js'
import { analyzeLogs, retryDelaySeconds, errorForStorage, withDeadline } from './analyze.js'
import { LOG_INDEX_LAG_HOURS, LOG_HOURS, LOG_FETCH } from './config.js'
import { listTypes, getType, updateType, deleteType, updateRun, listTypesWithHistory, resolveAndPersist } from './logTypes.js'
import { shouldSend, shouldAnalyze, kstDateString } from './schedule.js'
import { sendReportEmail } from './email.js'
import { repos } from '../../data/index.js'
import { forEachHub, isAllHubs } from '../../lib/forEachHub.js'
import { hubPageUrl } from '../../lib/hubUrl.js'

// 이 라우터의 async 핸들러를 전부 감싼다. Express 4는 async 거부를 잡지 않아,
// try 밖에서 던지면 응답이 없이 요청이 매달리고 서버리스 호출이 60초를 다 쓰고 504로 죽는다.
// 실제로 `?source=not-a-uuid` 하나로 재현됐다(2026-09-15). 라우트 정의 **전에** 감싼다.
const router = guardAsyncRouter(Router(), 'grafana-reports')
const DEFAULT_HUB = 'cs'

// 이 모듈 API는 **대상 허브의 비밀번호**를 요구한다(hubs.password_hash).
// 비밀번호가 설정되지 않은 허브는 공개고, APP_PASSWORD는 마스터키다.
// 자동 트리거(Bearer CRON_SECRET)는 이 검사를 지나가며 그 인가는 cronAuth가 한다.
// 전체 경계: README "인증 경계".
router.use(requireHubAccess(DEFAULT_HUB))

// source는 uuid 컬럼이다. 형식이 틀린 값은 존재할 수 없으므로 조회 전에 400으로 끊는다.
// (안전망이 있어도 형식 오류를 500으로 돌려줄 이유는 없다 — 클라이언트 잘못이다.)
router.use((req, res, next) => {
  const id = req.query.source ?? req.body?.source
  if (id != null && id !== '' && !isUuid(id)) {
    return res.status(400).json({ error: 'source 형식이 올바르지 않습니다' })
  }
  next()
})

const hubCache = new Map()
async function resolveHubId(key) {
  const k = key || DEFAULT_HUB
  if (hubCache.has(k)) return hubCache.get(k)
  // 조회 오류도 '없음'으로 본다(이전과 같은 동작 — 호출자가 404).
  const id = await repos.hubs.getHubId(k).catch(() => null)
  if (!id) return null
  hubCache.set(k, id)
  return id
}
function hubKeyOf(req) { return req.query.hub || req.body?.hub || DEFAULT_HUB }
function sourceIdOf(req) { return req.query.source || req.body?.source || null }

// source 파라미터가 있으면 그 소스(raw, 연결 포함)를, 없으면 그 허브의 첫(정렬순) 소스를 반환.
// 소유하지 않은 source id거나 허브에 소스가 없으면 null.
async function resolveSource(req, hubId) {
  const id = sourceIdOf(req)
  return id ? getSourceRaw(hubId, id) : firstSource(hubId)
}

// 응답용 소스(토큰 마스킹). 원문은 서버 내부에만 남는다.
function maskSource(s) { return s ? { ...s, token: maskToken(s.token) } : s }

// 설정의 log_lag_hours(0~24 정수)만 채택, 그 외엔 기본 상수로 폴백
function lagFrom(source) {
  const v = source?.log_lag_hours
  return Number.isInteger(v) && v >= 0 && v <= 24 ? v : LOG_INDEX_LAG_HOURS
}

// 설정에 수신자가 없을 때의 폴백(콤마 구분 env)
function envRecipients() {
  return (process.env.GRAFANA_EMAIL_TO ?? '').split(',').map((s) => s.trim()).filter(Boolean)
}

// 메일 상단 링크. 앱 리포트 페이지(허브 스코프) + 소스 연결로 만든 Grafana Explore 딥링크.
function reportLinks(source, hubKey = DEFAULT_HUB) {
  let grafanaUrl = ''
  try {
    const conn = resolveConn(source)
    grafanaUrl = grafanaLogExploreUrl({
      base: conn.url, esUid: conn.esUid,
      query: combineLogQueries(source.log_queries), hours: LOG_HOURS,
    })
  } catch { grafanaUrl = '' }
  return { reportUrl: hubPageUrl(hubKey, 'grafana-reports'), grafanaUrl }
}

const ARRAY_MAX = 50, QUERY_MAX = 2000, LABEL_MAX = 200, CONN_MAX = 500, NAME_MAX = 100
const isStr = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max
function isValidMetricArray(arr) {
  if (!Array.isArray(arr) || arr.length > ARRAY_MAX) return false
  return arr.every((m) => m && typeof m === 'object' && isStr(m.label, LABEL_MAX) && isStr(m.query, QUERY_MAX) && typeof m.threshold === 'number' && Number.isFinite(m.threshold) && typeof m.enabled === 'boolean')
}
function isValidLogArray(arr) {
  if (!Array.isArray(arr) || arr.length > ARRAY_MAX) return false
  return arr.every((q) => q && typeof q === 'object' && isStr(q.label, LABEL_MAX) && isStr(q.query, QUERY_MAX) && typeof q.enabled === 'boolean')
}

// 소스 생성/수정 바디 검증. partial=false면 name 필수. 반환 {fields}|{error}.
// 연결 컬럼(base_url/token/prom_uid/es_uid)은 빈 문자열 허용(빈=ENV 폴백).
function validateSourceFields(b, { partial } = {}) {
  const fields = {}
  if (b.name !== undefined) {
    if (typeof b.name !== 'string' || !b.name.trim() || b.name.length > NAME_MAX) return { error: 'invalid name' }
    fields.name = b.name.trim()
  } else if (!partial) return { error: 'name required' }
  if (b.sort_order !== undefined) {
    if (!Number.isInteger(b.sort_order)) return { error: 'invalid sort_order' }
    fields.sort_order = b.sort_order
  }
  for (const k of ['base_url', 'token', 'prom_uid', 'es_uid']) {
    if (b[k] !== undefined) {
      if (typeof b[k] !== 'string' || b[k].length > CONN_MAX) return { error: `invalid ${k}` }
      fields[k] = b[k]
    }
  }
  if (b.recipients !== undefined) {
    if (!Array.isArray(b.recipients) || b.recipients.some((r) => typeof r !== 'string')) return { error: 'invalid recipients' }
    fields.recipients = b.recipients.map((s) => s.trim()).filter(Boolean)
  }
  if (b.send_hour !== undefined) {
    if (!Number.isInteger(b.send_hour) || b.send_hour < 0 || b.send_hour > 23) return { error: 'invalid send_hour' }
    fields.send_hour = b.send_hour
  }
  if (b.enabled !== undefined) {
    if (typeof b.enabled !== 'boolean') return { error: 'invalid enabled' }
    fields.enabled = b.enabled
  }
  if (b.log_lag_hours !== undefined) {
    if (!Number.isInteger(b.log_lag_hours) || b.log_lag_hours < 0 || b.log_lag_hours > 24) return { error: 'invalid log_lag_hours' }
    fields.log_lag_hours = b.log_lag_hours
  }
  if (b.metrics !== undefined) {
    if (!isValidMetricArray(b.metrics)) return { error: 'invalid metrics' }
    fields.metrics = b.metrics
  }
  if (b.log_queries !== undefined) {
    if (!isValidLogArray(b.log_queries)) return { error: 'invalid log_queries' }
    fields.log_queries = b.log_queries
  }
  return { fields }
}

// ── 소스(환경) CRUD ──────────────────────────────────────────────────────

// GET /sources — 허브의 환경 목록(토큰 마스킹)
router.get('/sources', async (req, res) => {
  const hubId = await resolveHubId(hubKeyOf(req))
  if (!hubId) return res.status(404).json({ error: 'unknown hub' })
  try { res.json(await listSources(hubId)) }
  catch (e) { res.status(500).json({ error: e.message }) }
})

// POST /sources — 환경 추가
router.post('/sources', async (req, res) => {
  const hubId = await resolveHubId(hubKeyOf(req))
  if (!hubId) return res.status(404).json({ error: 'unknown hub' })
  const { fields, error } = validateSourceFields(req.body ?? {}, { partial: false })
  if (error) return res.status(400).json({ error })
  try { res.status(201).json(await createSource(hubId, fields)) }
  catch (e) { res.status(500).json({ error: e.message }) }
})

// PUT /sources/:id — 환경 수정(연결·메일·쿼리). 빈/마스킹 token은 기존 유지.
router.put('/sources/:id', async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: '소스 id 형식이 올바르지 않습니다' })
  const hubId = await resolveHubId(hubKeyOf(req))
  if (!hubId) return res.status(404).json({ error: 'unknown hub' })
  const { fields, error } = validateSourceFields(req.body ?? {}, { partial: true })
  if (error) return res.status(400).json({ error })
  if (Object.keys(fields).length === 0) return res.status(400).json({ error: 'no valid fields' })
  try {
    const s = await updateSource(hubId, req.params.id, fields)
    if (!s) return res.status(404).json({ error: 'not found' })
    res.json(s)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// DELETE /sources/:id — 환경 삭제(마지막 1개는 409)
router.delete('/sources/:id', async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: '소스 id 형식이 올바르지 않습니다' })
  const hubId = await resolveHubId(hubKeyOf(req))
  if (!hubId) return res.status(404).json({ error: 'unknown hub' })
  try {
    const r = await deleteSource(hubId, req.params.id)
    if (r.error === 'last-source') return res.status(409).json({ error: 'last-source' })
    if (r.error === 'not-found') return res.status(404).json({ error: 'not found' })
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── 리포트/설정/분석(선택 소스 스코프) ────────────────────────────────────

// GET /report — 라이브 on-demand 조회 (선택 소스 연결·쿼리 적용, LLM 미호출)
router.get('/report', async (req, res) => {
  const hubId = await resolveHubId(hubKeyOf(req))
  if (!hubId) return res.status(404).json({ error: 'unknown hub' })
  const source = await resolveSource(req, hubId)
  if (!source) return res.status(404).json({ error: 'no source' })
  try {
    const report = buildReport(await gatherReportData(source, source.metrics, source.log_queries, lagFrom(source)))
    res.json({ ...report, analysis: source.last_analysis ?? null })
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

// GET /settings — 선택 소스의 설정(토큰 마스킹)
router.get('/settings', async (req, res) => {
  const hubId = await resolveHubId(hubKeyOf(req))
  if (!hubId) return res.status(404).json({ error: 'unknown hub' })
  try {
    const source = await resolveSource(req, hubId)
    if (!source) return res.status(404).json({ error: 'no source' })
    res.json(maskSource(source))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// PUT /settings — 선택 소스 부분 갱신(연결·메일·쿼리). 검증 통과 필드만.
router.put('/settings', async (req, res) => {
  const hubId = await resolveHubId(hubKeyOf(req))
  if (!hubId) return res.status(404).json({ error: 'unknown hub' })
  const { fields, error } = validateSourceFields(req.body ?? {}, { partial: true })
  if (error) return res.status(400).json({ error })
  if (Object.keys(fields).length === 0) return res.status(400).json({ error: 'no valid fields' })
  try {
    const source = await resolveSource(req, hubId)
    if (!source) return res.status(404).json({ error: 'no source' })
    const s = await updateSource(hubId, source.id, fields)
    if (!s) return res.status(404).json({ error: 'not found' })
    res.json(s)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// POST /analyze — 선택 소스의 현재 로그로 LLM 1회 분석(미리보기, 저장 안 함)
router.post('/analyze', async (req, res) => {
  const hubId = await resolveHubId(hubKeyOf(req))
  if (!hubId) return res.status(404).json({ error: 'unknown hub' })
  const source = await resolveSource(req, hubId)
  if (!source) return res.status(404).json({ error: 'no source' })
  try {
    const { logs } = await gatherReportData(source, source.metrics, source.log_queries, lagFrom(source))
    const existing = await listTypesWithHistory(hubId, source.id).catch(() => [])
    const analysis = await analyzeLogs(logs, existing)
    res.json(analysis)
  } catch (e) {
    const code = /GEMINI_API_KEY/.test(e.message) ? 503 : 502
    res.status(code).json({ error: e.message })
  }
})

// ── 로그 유형(선택 소스 스코프) ───────────────────────────────────────────
//
// 경로 파라미터는 **조회 전에** 형식을 본다. 유형 id는 uuid, 회차 id는 bigint 컬럼이라
// 형식이 틀린 값을 그대로 넘기면 Postgres가 22P02로 던지고 catch가 그것을 500 + 원문
// 오류로 내보낸다 — 클라이언트 잘못을 서버 오류로 보고하면서 내부 스키마까지 흘린다.
// 형식이 틀린 값은 존재할 수 없는 값이므로 400이 맞다.

// GET /log-types — 선택 소스의 영속 로그 유형 목록
router.get('/log-types', async (req, res) => {
  const hubId = await resolveHubId(hubKeyOf(req)); if (!hubId) return res.status(404).json({ error: 'unknown hub' })
  const source = await resolveSource(req, hubId); if (!source) return res.status(404).json({ error: 'no source' })
  try { res.json(await listTypes(hubId, source.id)) } catch (e) { res.status(500).json({ error: e.message }) }
})
// GET /log-types/:id — 유형 상세(runs/entries 포함)
router.get('/log-types/:id', async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: '유형 id 형식이 올바르지 않습니다' })
  const hubId = await resolveHubId(hubKeyOf(req)); if (!hubId) return res.status(404).json({ error: 'unknown hub' })
  const source = await resolveSource(req, hubId); if (!source) return res.status(404).json({ error: 'no source' })
  try { const t = await getType(hubId, source.id, req.params.id); if (!t) return res.status(404).json({ error: 'not found' }); res.json(t) }
  catch (e) { res.status(500).json({ error: e.message }) }
})
// PATCH /log-types/:id — note/label/description만 갱신
router.patch('/log-types/:id', async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: '유형 id 형식이 올바르지 않습니다' })
  const hubId = await resolveHubId(hubKeyOf(req)); if (!hubId) return res.status(404).json({ error: 'unknown hub' })
  const source = await resolveSource(req, hubId); if (!source) return res.status(404).json({ error: 'no source' })
  const fields = {}; for (const k of ['note', 'label', 'description']) if (req.body[k] !== undefined) fields[k] = req.body[k] == null ? null : String(req.body[k])
  if (!Object.keys(fields).length) return res.status(400).json({ error: 'no valid fields' })
  try { const t = await updateType(hubId, source.id, req.params.id, fields); if (!t) return res.status(404).json({ error: 'not found' }); res.json(t) }
  catch (e) { res.status(500).json({ error: e.message }) }
})
// DELETE /log-types/:id — 유형 삭제
router.delete('/log-types/:id', async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: '유형 id 형식이 올바르지 않습니다' })
  const hubId = await resolveHubId(hubKeyOf(req)); if (!hubId) return res.status(404).json({ error: 'unknown hub' })
  const source = await resolveSource(req, hubId); if (!source) return res.status(404).json({ error: 'no source' })
  try { await deleteType(hubId, source.id, req.params.id); res.json({ ok: true }) } catch (e) { res.status(500).json({ error: e.message }) }
})
// PATCH /log-type-runs/:runId — 회차별 메모 저장
router.patch('/log-type-runs/:runId', async (req, res) => {
  // 회차는 bigint 키다 — 형식이 틀리면 조회 전에 끊는다(그대로 넘기면 22P02 → 500 + 원문 노출).
  if (!isIntId(req.params.runId)) return res.status(400).json({ error: '회차 id 형식이 올바르지 않습니다' })
  const hubId = await resolveHubId(hubKeyOf(req)); if (!hubId) return res.status(404).json({ error: 'unknown hub' })
  const source = await resolveSource(req, hubId); if (!source) return res.status(404).json({ error: 'no source' })
  const note = req.body.note == null ? null : String(req.body.note)
  try { const r = await updateRun(hubId, source.id, req.params.runId, note); if (!r) return res.status(404).json({ error: 'not found' }); res.json(r) }
  catch (e) { res.status(500).json({ error: e.message }) }
})

// POST /test-query — 선택 소스 연결로 메트릭/로그 쿼리를 저장 전 시험 조회
router.post('/test-query', async (req, res) => {
  const hubId = await resolveHubId(hubKeyOf(req)); if (!hubId) return res.status(404).json({ error: 'unknown hub' })
  const source = await resolveSource(req, hubId); if (!source) return res.status(404).json({ error: 'no source' })
  const { type, query } = req.body
  if ((type !== 'metric' && type !== 'log') || typeof query !== 'string' || !query.trim() || query.length > 2000) return res.status(400).json({ error: 'invalid request' })
  try {
    if (type === 'metric') { const value = await queryPrometheus(source, query); return res.json({ ok: true, value }) }
    const result = await queryElasticsearch(source, [{ label: '_test', query }], LOG_HOURS, LOG_FETCH, lagFrom(source))
    return res.json({ ok: true, count: result?._test?.count ?? 0 })
  } catch (e) { return res.json({ ok: false, error: e.message }) }
})

// ── 크론 tick(활성 소스 순회) ─────────────────────────────────────────────

// 분석이 끝나야 하는 시각(tick 시작 기준). 함수 한도 60초에서 영속화·SMTP 발송 몫을 남긴다.
// Grafana 조회가 길어지면 그만큼 분석 몫이 줄어든다 — 상한은 '분석 시간'이 아니라 '마감 시각'이다.
const TICK_ANALYZE_DEADLINE_MS = 40_000

// 한 소스 처리. 발송/분석 판단 → 조회·분석·발송·영속화. 소스별 last_sent_date claim.
async function tickSource(hubId, source, now, hubKey = DEFAULT_HUB, deadlineAt = Date.now() + TICK_ANALYZE_DEADLINE_MS) {
  const sendDecision = shouldSend(source, now)
  const analyzeDecision = shouldAnalyze(source, now)
  const recipients = sendDecision.send ? (source.recipients?.length ? source.recipients : envRecipients()) : []
  const willSend = sendDecision.send && recipients.length > 0
  const base = { source_id: source.id, name: source.name }
  if (!willSend && !analyzeDecision.run) {
    const reason = (sendDecision.send && recipients.length === 0) ? 'no-recipients' : sendDecision.reason
    const out = { ...base, sent: false, analyzed: false, reason }
    // 발송 사유만 실으면 "분석을 왜 안 했나"가 응답에서 사라진다 — 할당량 차단이
    // 'not-time'으로 보인다. 크론 응답이 유일한 관측 지점이라 사유가 다르면 함께 싣는다.
    if (analyzeDecision.reason && analyzeDecision.reason !== reason) out.analyze_reason = analyzeDecision.reason
    return out
  }
  const data = await gatherReportData(source, source.metrics, source.log_queries, lagFrom(source))
  const report = buildReport(data)
  let summary = '', analyzed = false, analyzeError = null, blockedUntil = null
  // 늦은 발송(따라잡기)은 오늘 분석이 이미 끝난 뒤일 수 있다 — 그 요약을 싣고 '실패'로 표시하지 않는다.
  const analyzedToday = analyzeDecision.reason === 'already-analyzed'
  if (analyzedToday) summary = source.last_analysis?.summary ?? ''
  if (analyzeDecision.run) {
    try {
      const types = await listTypesWithHistory(hubId, source.id)
      const analysis = await withDeadline(analyzeLogs(data.logs, types), deadlineAt - Date.now())
      summary = analysis.summary ?? ''
      if (analysis.types.length) await resolveAndPersist(hubId, source.id, analysis, now.toISOString(), data.logs)
      const patch = { last_analysis_date: kstDateString(now) }
      if (analysis.types.length || summary) patch.last_analysis = { summary, generated_at: now.toISOString() }
      await updateSource(hubId, source.id, patch)
      analyzed = true
    } catch (err) {
      // 실패해도 발송은 계속하고 다음 tick에 재시도한다. 다만 **흔적은 남긴다** —
      // 예전에는 통째로 버려서, 분석이 매일 실패해도 메일의 AI 요약만 조용히 비고
      // 아무도 알 수 없었다(발송 실패는 바로 아래에서 이미 남기고 있었다).
      console.error(`[grafana-reports/tick] analyze failed (source=${source.id}):`, err)
      analyzeError = String(err?.message ?? err)
      // 크론 응답은 ~1시간이면 지워진다(10/13·10/14 07시 실패 원인을 그렇게 놓쳤다).
      // 사유를 소스 행에 남겨 사후에 본다. 기록이 실패해도 발송은 막지 않는다.
      try {
        await updateSource(hubId, source.id, { last_analysis_error: errorForStorage(err), last_analysis_error_at: now.toISOString() })
      } catch (e2) {
        console.error(`[grafana-reports/tick] 분석 실패 사유 기록 실패 (source=${source.id}):`, e2)
      }
      // 할당량 고갈은 몇 초 뒤 재시도로 넘길 수 있는 벽이 아니다. 서버가 알려준 시각까지
      // 아예 부르지 않는다 — 매시 재시도가 성공하지 못한 채 남은 할당량만 깎았다.
      const wait = retryDelaySeconds(err)
      if (wait) {
        blockedUntil = new Date(now.getTime() + wait * 1000).toISOString()
        try {
          await updateSource(hubId, source.id, { analysis_blocked_until: blockedUntil })
        } catch (e2) {
          console.error(`[grafana-reports/tick] 차단 시각 기록 실패 (source=${source.id}):`, e2)
        }
      }
    }
  }
  let sendError = null
  if (willSend) {
    // 발송 슬롯 선점(claim-before-send): 발송 전에 먼저 '오늘 보냄'을 기록해 중복 발송을 막는다.
    await updateSource(hubId, source.id, { last_sent_date: kstDateString(now) })
    try {
      await sendReportEmail(buildEmailHtml(report, summary, reportLinks(source, hubKey), { failed: !analyzed && !analyzedToday }), recipients)
    } catch (err) {
      console.error('[grafana-reports/tick] sendReportEmail failed (claim already saved, no retry today):', err)
      sendError = String(err?.message ?? err)
    }
  }
  const out = { ...base, sent: willSend && !sendError, analyzed, alerts: report.summary.alerts }
  if (analyzeError) out.analyze_error = analyzeError
  if (blockedUntil) out.analysis_blocked_until = blockedUntil
  if (sendDecision.send && !willSend) out.reason = 'no-recipients'
  if (willSend && sendDecision.reason === 'late') out.late = true
  if (sendError) out.error = sendError
  return out
}

// GET /tick — 크론 전용(CRON_SECRET). 허브의 모든 소스를 순회, 소스별 격리(한 소스 실패가 타 소스를 막지 않음).
router.get('/tick', async (req, res) => {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers['authorization'] !== `Bearer ${secret}`) return res.status(401).json({ error: 'unauthorized' })
  // ?hub=* — Grafana 리포트가 켜진 모든 허브(사내 CronJob). 그 밖은 지금처럼 허브 하나.
  if (isAllHubs(req)) return res.json({ hubs: await forEachHub('grafana-reports', (h) => tickHub(h.id, h.key)) })
  const hubKey = hubKeyOf(req)
  const hubId = await resolveHubId(hubKey); if (!hubId) return res.status(404).json({ error: 'unknown hub' })
  try {
    res.json(await tickHub(hubId, hubKey))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

async function tickHub(hubId, hubKey) {
  const now = new Date()
  const deadlineAt = Date.now() + TICK_ANALYZE_DEADLINE_MS
  const sources = await listSourcesRaw(hubId)
  const results = []
  for (const source of sources) {
    try {
      results.push(await tickSource(hubId, source, now, hubKey, deadlineAt))
    } catch (e) {
      results.push({ source_id: source.id, name: source.name, sent: false, analyzed: false, error: String(e?.message ?? e) })
    }
  }
  return { results }
}

finalizeAsyncRouter(router)

export default router
