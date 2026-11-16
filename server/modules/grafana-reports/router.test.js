import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// hubs 조회 결과는 테스트마다 바꿀 수 있어야 한다 — requireHubAccess가 password_hash를 본다.
const hubRow = vi.hoisted(() => ({ current: { id: 'hub-cs-id' } }))
vi.mock('../../db.js', () => {
  const api = { from() { return api }, select() { return api }, eq(_c, v) { api._hub = v; return api }, single() { return Promise.resolve({ data: hubRow.current, error: null }) } }
  return { default: api }
})
vi.mock('./client.js', () => ({
  gatherReportData: vi.fn(async () => ({
    metrics: [{ label: 'CPU', value: 10, threshold: 80, error: null }],
    logs: [{ app: 'soe', count: 0, rows: [], error: null }],
  })),
  queryPrometheus: vi.fn(async () => 42),
  queryElasticsearch: vi.fn(async () => ({ _test: { count: 7, rows: [] } })),
  resolveConn: vi.fn(() => ({ url: 'https://g', token: 't', promUid: 'p', esUid: 'e' })),
}))

// 기본 소스 팩토리(테스트 간 변형 방지)
const mkSource = (over = {}) => ({
  id: 'src-1', hub_id: 'hub-cs-id', name: '운영', sort_order: 0,
  token: 'glsa_secret', base_url: '', prom_uid: '', es_uid: '',
  metrics: [], log_queries: [], last_analysis: { summary: '- 점검 요약' },
  send_hour: 9, enabled: true, recipients: [], log_lag_hours: null, ...over,
})

vi.mock('./sources.js', () => ({
  listSources: vi.fn(async () => [mkSource({ token: 'glsa****' })]),
  listSourcesRaw: vi.fn(async () => [mkSource()]),
  getSourceRaw: vi.fn(async (_h, id) => (id === 'missing' ? null : mkSource({ id }))),
  firstSource: vi.fn(async () => mkSource()),
  createSource: vi.fn(async (_h, f) => mkSource({ id: 'new-src', token: 'glsa****', ...f })),
  updateSource: vi.fn(async (_h, id, f) => (id === MISSING_SRC ? null : mkSource({ id, token: 'glsa****', ...f }))),
  deleteSource: vi.fn(async (_h, id) => (id === LAST_SRC ? { error: 'last-source' } : id === MISSING_SRC ? { error: 'not-found' } : { ok: true })),
  maskToken: vi.fn((t) => (t ? String(t).slice(0, 4) + '****' : '')),
}))
// LLM 호출만 목으로 바꾸고 나머지(retryDelaySeconds 등 순수 함수)는 **원본을 그대로 쓴다.**
// 손으로 적은 목은 모듈에 export가 늘면 조용히 어긋난다 — 실제로 그렇게 됐었다
// (빠진 export가 undefined가 되어 호출부가 던졌고, 무관한 테스트가 깨졌다).
vi.mock('./analyze.js', async (importOriginal) => ({
  ...(await importOriginal()),
  analyzeLogs: vi.fn(async () => ({ summary: '- 신규 분석', types: [] })),
}))
// 실제 컬럼 타입은 uuid(유형)와 bigint(회차)다. 라우터가 형식을 먼저 보므로
// 테스트도 실제와 같은 형식의 id를 쓴다 — 'missing' 같은 값은 이제 404가 아니라 400이다.
const TYPE_ID = vi.hoisted(() => '11111111-1111-4111-8111-111111111111')
const MISSING_ID = vi.hoisted(() => '22222222-2222-4222-8222-222222222222')
const OTHER_SRC = vi.hoisted(() => '33333333-3333-4333-8333-333333333333')
// 소스 id도 uuid 컬럼이다 — 'missing'·'last' 같은 표식 대신 형식이 맞는 값을 쓴다.
const SRC_ID = vi.hoisted(() => '44444444-4444-4444-8444-444444444444')
const MISSING_SRC = vi.hoisted(() => '55555555-5555-4555-8555-555555555555')
const LAST_SRC = vi.hoisted(() => '66666666-6666-4666-8666-666666666666')
const RUN_ID = vi.hoisted(() => '1')
const MISSING_RUN = vi.hoisted(() => '2')
vi.mock('./logTypes.js', () => ({
  listTypes: vi.fn(async () => [{ id: 't1', label: 'foo' }]),
  listTypesWithHistory: vi.fn(async () => [{ id: 't1', label: 'foo', recentRuns: [] }]),
  getType: vi.fn(async (_h, _s, id) => (id === MISSING_ID ? null : { id, label: 'foo', runs: [], entries: [] })),
  updateType: vi.fn(async (_h, _s, id, fields) => (id === MISSING_ID ? null : { id, ...fields })),
  deleteType: vi.fn(async () => true),
  updateRun: vi.fn(async (_h, _s, runId, note) => (runId === MISSING_RUN ? null : { id: runId, note })),
  resolveAndPersist: vi.fn(async () => {}),
}))
vi.mock('./schedule.js', () => ({
  shouldSend: vi.fn(() => ({ send: true, reason: 'ok' })),
  shouldAnalyze: vi.fn(() => ({ run: true, reason: 'ok' })),
  kstDateString: vi.fn(() => '2026-07-23'),
}))
vi.mock('./email.js', () => ({ sendReportEmail: vi.fn(async () => {}) }))

import router from './router.js'
import { hashPassword } from '../../lib/hubPassword.js'

const CS_HASH = hashPassword('cs-pw')

function app() {
  const a = express(); a.use(express.json()); a.use('/api/modules/grafana-reports', router); return a
}
const PW = { 'x-app-password': 'test-pw' }
const CRON = { Authorization: 'Bearer test-cron-secret' }
const base = '/api/modules/grafana-reports'
beforeEach(() => {
  process.env.APP_PASSWORD = 'test-pw'
  process.env.CRON_SECRET = 'test-cron-secret'
  hubRow.current = { id: 'hub-cs-id' }  // 기본은 비밀번호 없는(공개) 허브
  vi.clearAllMocks()
})

describe('grafana-reports router — 기존 엔드포인트(소스 스코프)', () => {
  // 인증 경계: 이 모듈 API는 **대상 허브의 비밀번호**를 요구한다(판정 자체는
  // server/lib/hubAuth.test.js). 여기서는 미들웨어가 걸려 있는지만 확인한다.
  // 자동 트리거(tick)의 Bearer CRON_SECRET은 별개 비밀이며 아래에서 따로 검증한다.
  it('GET /report 비밀번호 없는 허브는 공개 — 401이 아니다', async () => {
    expect((await request(app()).get(`${base}/report?hub=cs`)).status).not.toBe(401)
  })

  it('GET /report 비밀번호가 걸린 허브는 401', async () => {
    hubRow.current = { id: 'hub-cs-id', key: 'cs', name: 'CS', password_hash: CS_HASH }
    const res = await request(app()).get(`${base}/report?hub=cs`)
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('HUB_PASSWORD_REQUIRED')
  })

  it('GET /report 맞는 허브 비밀번호면 통과', async () => {
    hubRow.current = { id: 'hub-cs-id', key: 'cs', name: 'CS', password_hash: CS_HASH }
    const res = await request(app()).get(`${base}/report?hub=cs`).set('x-hub-password', 'cs-pw')
    expect(res.status).toBe(200)
  })

  it('GET /report 인증 시 리포트 JSON + 소스 last_analysis 반환', async () => {
    const res = await request(app()).get(`${base}/report?hub=cs`).set(PW)
    expect(res.status).toBe(200)
    expect(res.body.summary.status).toBe('ok')
    expect(res.body.analysis).toEqual({ summary: '- 점검 요약' })
  })

  it('GET /settings 인증 시 소스 반환 + 토큰 마스킹', async () => {
    const res = await request(app()).get(`${base}/settings?hub=cs`).set(PW)
    expect(res.status).toBe(200)
    expect(res.body.send_hour).toBe(9)
    expect(res.body.token).toBe('glsa****')
    expect(res.body.token).not.toContain('secret')
  })

  it('PUT /settings 부분 갱신 → updateSource 위임', async () => {
    const { updateSource } = await import('./sources.js')
    const res = await request(app()).put(`${base}/settings?hub=cs`).set(PW).send({ send_hour: 8 })
    expect(res.status).toBe(200)
    expect(res.body.send_hour).toBe(8)
    expect(updateSource).toHaveBeenCalledWith('hub-cs-id', 'src-1', expect.objectContaining({ send_hour: 8 }))
  })

  it('PUT /settings 유효 필드 없으면 400', async () => {
    expect((await request(app()).put(`${base}/settings?hub=cs`).set(PW).send({})).status).toBe(400)
  })

  it('POST /analyze는 listTypesWithHistory(hubId, sourceId)로 조회', async () => {
    const { listTypesWithHistory } = await import('./logTypes.js')
    const { analyzeLogs } = await import('./analyze.js')
    const res = await request(app()).post(`${base}/analyze?hub=cs`).set(PW).send({})
    expect(res.status).toBe(200)
    expect(res.body.summary).toBe('- 신규 분석')
    expect(listTypesWithHistory).toHaveBeenCalledWith('hub-cs-id', 'src-1')
    expect(analyzeLogs).toHaveBeenCalledWith(expect.anything(), [{ id: 't1', label: 'foo', recentRuns: [] }])
  })

  it('source 파라미터 지정 시 getSourceRaw로 그 소스 스코프', async () => {
    const { getSourceRaw } = await import('./sources.js')
    const res = await request(app()).get(`${base}/report?hub=cs&source=${OTHER_SRC}`).set(PW)
    expect(res.status).toBe(200)
    expect(getSourceRaw).toHaveBeenCalledWith('hub-cs-id', OTHER_SRC)
  })

  it('허브에 소스가 없으면 404 (no source)', async () => {
    const { firstSource } = await import('./sources.js')
    firstSource.mockResolvedValueOnce(null)
    const res = await request(app()).get(`${base}/report?hub=cs`).set(PW)
    expect(res.status).toBe(404)
  })

  it('unknown hub → 404', async () => {
    const { default: db } = await import('../../db.js')
    const orig = db.single
    db.single = () => Promise.resolve({ data: null, error: null })
    const res = await request(app()).get(`${base}/report?hub=nope`).set(PW)
    expect(res.status).toBe(404)
    db.single = orig
  })
})

describe('grafana-reports router — 소스 CRUD', () => {
  it('GET /sources 목록(마스킹)', async () => {
    const res = await request(app()).get(`${base}/sources?hub=cs`).set(PW)
    expect(res.status).toBe(200)
    expect(res.body[0].token).toBe('glsa****')
  })

  it('POST /sources name 없으면 400', async () => {
    expect((await request(app()).post(`${base}/sources?hub=cs`).set(PW).send({})).status).toBe(400)
  })

  it('POST /sources 생성 201', async () => {
    const { createSource } = await import('./sources.js')
    const res = await request(app()).post(`${base}/sources?hub=cs`).set(PW)
      .send({ name: '스테이징', base_url: 'https://stg', token: 'glsa_new', send_hour: 7 })
    expect(res.status).toBe(201)
    expect(res.body.name).toBe('스테이징')
    expect(createSource).toHaveBeenCalledWith('hub-cs-id', expect.objectContaining({ name: '스테이징', token: 'glsa_new' }))
  })

  it('POST /sources send_hour 범위 밖 400', async () => {
    expect((await request(app()).post(`${base}/sources?hub=cs`).set(PW).send({ name: 'x', send_hour: 99 })).status).toBe(400)
  })

  it('PUT /sources/:id 수정 200', async () => {
    const res = await request(app()).put(`${base}/sources/${SRC_ID}?hub=cs`).set(PW).send({ name: '변경' })
    expect(res.status).toBe(200)
    expect(res.body.name).toBe('변경')
  })

  it('PUT /sources/:id 없으면 404', async () => {
    expect((await request(app()).put(`${base}/sources/${MISSING_SRC}?hub=cs`).set(PW).send({ name: 'x' })).status).toBe(404)
  })

  it('DELETE /sources/:id 마지막 1개는 409', async () => {
    expect((await request(app()).delete(`${base}/sources/${LAST_SRC}?hub=cs`).set(PW)).status).toBe(409)
  })

  it('DELETE /sources/:id 없으면 404', async () => {
    expect((await request(app()).delete(`${base}/sources/${MISSING_SRC}?hub=cs`).set(PW)).status).toBe(404)
  })

  it('DELETE /sources/:id 정상 삭제 200', async () => {
    const res = await request(app()).delete(`${base}/sources/${SRC_ID}?hub=cs`).set(PW)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })
})

describe('grafana-reports router — 로그 유형(소스 스코프)', () => {
  it('GET /log-types 배열 반환', async () => {
    const { listTypes } = await import('./logTypes.js')
    const res = await request(app()).get(`${base}/log-types?hub=cs`).set(PW)
    expect(res.status).toBe(200)
    expect(res.body).toEqual([{ id: 't1', label: 'foo' }])
    expect(listTypes).toHaveBeenCalledWith('hub-cs-id', 'src-1')
  })

  it('GET /log-types/:id 200 / 404', async () => {
    expect((await request(app()).get(`${base}/log-types/${TYPE_ID}?hub=cs`).set(PW)).status).toBe(200)
    expect((await request(app()).get(`${base}/log-types/${MISSING_ID}?hub=cs`).set(PW)).status).toBe(404)
  })

  it('PATCH /log-types/:id note 갱신 / 빈 400 / 404', async () => {
    const ok = await request(app()).patch(`${base}/log-types/${TYPE_ID}?hub=cs`).set(PW).send({ note: '완료' })
    expect(ok.status).toBe(200); expect(ok.body.note).toBe('완료')
    expect((await request(app()).patch(`${base}/log-types/${TYPE_ID}?hub=cs`).set(PW).send({})).status).toBe(400)
    expect((await request(app()).patch(`${base}/log-types/${MISSING_ID}?hub=cs`).set(PW).send({ note: 'x' })).status).toBe(404)
  })

  it('DELETE /log-types/:id 200', async () => {
    const res = await request(app()).delete(`${base}/log-types/${TYPE_ID}?hub=cs`).set(PW)
    expect(res.status).toBe(200); expect(res.body).toEqual({ ok: true })
  })

  it('PATCH /log-type-runs/:runId 200 / 404', async () => {
    const ok = await request(app()).patch(`${base}/log-type-runs/${RUN_ID}?hub=cs`).set(PW).send({ note: '메모' })
    expect(ok.status).toBe(200); expect(ok.body).toEqual({ id: RUN_ID, note: '메모' })
    expect((await request(app()).patch(`${base}/log-type-runs/${MISSING_RUN}?hub=cs`).set(PW).send({ note: 'x' })).status).toBe(404)
  })
})

describe('grafana-reports router — test-query', () => {
  it('metric 200', async () => {
    const res = await request(app()).post(`${base}/test-query?hub=cs`).set(PW).send({ type: 'metric', query: 'up' })
    expect(res.status).toBe(200); expect(res.body).toEqual({ ok: true, value: 42 })
  })
  it('log 200', async () => {
    const res = await request(app()).post(`${base}/test-query?hub=cs`).set(PW).send({ type: 'log', query: 'app:"soe"' })
    expect(res.status).toBe(200); expect(res.body).toEqual({ ok: true, count: 7 })
  })
  it('잘못된 타입/누락 400', async () => {
    expect((await request(app()).post(`${base}/test-query?hub=cs`).set(PW).send({ type: 'bogus', query: 'x' })).status).toBe(400)
    expect((await request(app()).post(`${base}/test-query?hub=cs`).set(PW).send({ type: 'metric' })).status).toBe(400)
  })
})

describe('grafana-reports router — tick(소스 순회)', () => {
  it('무/잘못된 Bearer 401', async () => {
    expect((await request(app()).get(`${base}/tick?hub=cs`)).status).toBe(401)
    expect((await request(app()).get(`${base}/tick?hub=cs`).set('Authorization', 'Bearer wrong')).status).toBe(401)
  })

  it('각 소스가 자기 판단으로 발송/분석, results 배열 반환', async () => {
    const { listSourcesRaw, updateSource } = await import('./sources.js')
    const { resolveAndPersist } = await import('./logTypes.js')
    const { sendReportEmail } = await import('./email.js')
    const { analyzeLogs } = await import('./analyze.js')
    listSourcesRaw.mockResolvedValueOnce([mkSource({ id: 's1', recipients: ['a@x.com'] })])
    analyzeLogs.mockResolvedValueOnce({ summary: '- 분석', types: [{ label: 'foo', app: 'soe', count: 1, rows: [] }] })

    const res = await request(app()).get(`${base}/tick?hub=cs`).set(CRON)
    expect(res.status).toBe(200)
    expect(res.body.results).toHaveLength(1)
    expect(res.body.results[0]).toMatchObject({ source_id: 's1', sent: true, analyzed: true, alerts: 0 })
    expect(sendReportEmail.mock.calls[0][1]).toEqual(['a@x.com'])
    expect(resolveAndPersist).toHaveBeenCalledWith('hub-cs-id', 's1', expect.objectContaining({ summary: '- 분석' }), expect.any(String), expect.anything())
    expect(updateSource).toHaveBeenCalledWith('hub-cs-id', 's1', { last_sent_date: '2026-07-23' })
  })

  it('발송 소스는 last_sent_date 선점이 sendReportEmail보다 먼저', async () => {
    const { listSourcesRaw, updateSource } = await import('./sources.js')
    const { sendReportEmail } = await import('./email.js')
    listSourcesRaw.mockResolvedValueOnce([mkSource({ id: 's1', recipients: ['a@x.com'] })])
    await request(app()).get(`${base}/tick?hub=cs`).set(CRON)
    const claimIdx = updateSource.mock.calls.findIndex(([, , f]) => f && 'last_sent_date' in f)
    expect(claimIdx).toBeGreaterThanOrEqual(0)
    expect(updateSource.mock.invocationCallOrder[claimIdx]).toBeLessThan(sendReportEmail.mock.invocationCallOrder[0])
  })

  it('sendReportEmail 실패해도 선점 유지 + 해당 소스 error, 200', async () => {
    const { listSourcesRaw, updateSource } = await import('./sources.js')
    const { sendReportEmail } = await import('./email.js')
    listSourcesRaw.mockResolvedValueOnce([mkSource({ id: 's1', recipients: ['a@x.com'] })])
    sendReportEmail.mockRejectedValueOnce(new Error('smtp down'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await request(app()).get(`${base}/tick?hub=cs`).set(CRON)
    expect(res.status).toBe(200)
    expect(res.body.results[0].sent).toBe(false)
    expect(res.body.results[0].error).toContain('smtp down')
    expect(updateSource).toHaveBeenCalledWith('hub-cs-id', 's1', { last_sent_date: '2026-07-23' })
    spy.mockRestore()
  })

  // 분석 실패는 오랫동안 아무 흔적도 남기지 않았다 — 바로 아래 발송 실패는 console.error로
  // 남기는데 분석만 `catch { }`로 통째로 버렸다. 그래서 프로덕션에서 같은 날 회차가 여러 번
  // 적재된 것을 발견하고도 **어느 호출이 실패했는지 알 수 없었다.**
  it('분석이 실패하면 로그를 남기고 결과에 사유를 싣는다 — 발송은 그대로 진행', async () => {
    const { listSourcesRaw } = await import('./sources.js')
    const { analyzeLogs } = await import('./analyze.js')
    listSourcesRaw.mockResolvedValueOnce([mkSource({ id: 's1', recipients: ['a@x.com'] })])
    analyzeLogs.mockRejectedValueOnce(new Error('gemini 429'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await request(app()).get(`${base}/tick?hub=cs`).set(CRON)

    expect(res.status).toBe(200)
    expect(res.body.results[0].analyzed).toBe(false)
    expect(res.body.results[0].analyze_error).toContain('gemini 429')
    expect(res.body.results[0].sent).toBe(true)
    expect(spy.mock.calls.flat().join(' ')).toContain('gemini 429')
    spy.mockRestore()
  })

  // 할당량 고갈은 몇 초 뒤 재시도로 넘길 수 있는 벽이 아니다. 서버가 알려준 시각을
  // 적어 두고 그때까지 아예 부르지 않는다 — 매시 재시도가 남은 할당량을 더 태웠다.
  it('할당량 고갈이면 서버가 알려준 시각을 analysis_blocked_until에 적는다', async () => {
    const { listSourcesRaw, updateSource } = await import('./sources.js')
    const { analyzeLogs } = await import('./analyze.js')
    listSourcesRaw.mockResolvedValueOnce([mkSource({ id: 's1' })])
    analyzeLogs.mockRejectedValueOnce(new Error('[429] quota exceeded [{"retryDelay":"69302s"}]'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await request(app()).get(`${base}/tick?hub=cs`).set(CRON)

    const call = updateSource.mock.calls.find(([, , f]) => f && 'analysis_blocked_until' in f)
    expect(call).toBeTruthy()
    const until = new Date(call[2].analysis_blocked_until).getTime()
    expect(until).toBeGreaterThan(Date.now() + 69000 * 1000)
    spy.mockRestore()
  })

  // 크론 응답(net._http_response)은 ~1시간이면 지워진다 — 10/13·10/14 07시 실패 원인을
  // 그렇게 놓쳤다. 사유를 소스 행에 남겨 사후에 본다(ROADMAP v0.10.0 항목8).
  it('분석이 실패하면 사유와 시각을 소스 행에 남긴다(키는 가려서)', async () => {
    const { listSourcesRaw, updateSource } = await import('./sources.js')
    const { analyzeLogs } = await import('./analyze.js')
    listSourcesRaw.mockResolvedValueOnce([mkSource({ id: 's1' })])
    analyzeLogs.mockRejectedValueOnce(new Error('[503] unavailable ?key=AIzaSySECRETSECRETSECRETSECRET'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await request(app()).get(`${base}/tick?hub=cs`).set(CRON)

    const call = updateSource.mock.calls.find(([, , f]) => f && 'last_analysis_error' in f)
    expect(call).toBeTruthy()
    expect(call[2].last_analysis_error).toContain('[503] unavailable')
    expect(call[2].last_analysis_error).not.toContain('AIza')
    expect(Number.isNaN(Date.parse(call[2].last_analysis_error_at))).toBe(false)
    spy.mockRestore()
  })

  it('사유 기록이 실패해도 tick은 계속된다(발송 진행)', async () => {
    const { listSourcesRaw, updateSource } = await import('./sources.js')
    const { analyzeLogs } = await import('./analyze.js')
    listSourcesRaw.mockResolvedValueOnce([mkSource({ id: 's1', recipients: ['a@x.com'] })])
    analyzeLogs.mockRejectedValueOnce(new Error('[503] unavailable'))
    updateSource.mockImplementationOnce(async () => { throw new Error('column does not exist') })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await request(app()).get(`${base}/tick?hub=cs`).set(CRON)

    expect(res.status).toBe(200)
    expect(res.body.results[0].sent).toBe(true)
    spy.mockRestore()
  })

  // 10/26 07시: 503 재시도 + 대체 모델 재시도가 함수 한도(60초)를 넘겨 tick이 잘렸고,
  // 선점 기록 전이라 발송도 실패 사유도 남지 않았다. 분석이 마감을 넘기면 분석만 포기한다.
  it('분석이 마감을 넘기면 포기하고 메일은 "요약 실패" 표시로 발송한다', async () => {
    const { listSourcesRaw, updateSource } = await import('./sources.js')
    const { analyzeLogs } = await import('./analyze.js')
    const { sendReportEmail } = await import('./email.js')
    listSourcesRaw.mockResolvedValueOnce([mkSource({ id: 's1', recipients: ['a@x.com'] })])
    // 분석이 시작되는 순간 시계를 마감 너머로 옮긴다(끝나지 않는 분석 + 41초 경과).
    const realNow = Date.now
    let shift = 0
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + shift)
    analyzeLogs.mockImplementationOnce(() => { shift = 41_000; return new Promise(() => {}) })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await request(app()).get(`${base}/tick?hub=cs`).set(CRON)
    clock.mockRestore()

    expect(res.body.results[0]).toMatchObject({ sent: true, analyzed: false })
    expect(res.body.results[0].analyze_error).toContain('analysis-timeout')
    expect(updateSource.mock.calls.find(([, , f]) => f && 'last_analysis_error' in f)[2].last_analysis_error).toContain('analysis-timeout')
    expect(sendReportEmail.mock.calls.at(-1)[0]).toContain('요약을 생성하지 못했습니다')
    spy.mockRestore()
  })

  it('따라잡기 발송은 오늘 이미 끝난 분석 요약을 싣고 Gemini를 다시 부르지 않는다', async () => {
    const { listSourcesRaw } = await import('./sources.js')
    const { analyzeLogs } = await import('./analyze.js')
    const { sendReportEmail } = await import('./email.js')
    const { shouldSend, shouldAnalyze } = await import('./schedule.js')
    shouldSend.mockReturnValueOnce({ send: true, reason: 'late' })
    shouldAnalyze.mockReturnValueOnce({ run: false, reason: 'already-analyzed' })
    listSourcesRaw.mockResolvedValueOnce([mkSource({ id: 's1', recipients: ['a@x.com'], last_analysis: { summary: '- 08시 요약' } })])
    analyzeLogs.mockClear()

    const res = await request(app()).get(`${base}/tick?hub=cs`).set(CRON)

    expect(res.body.results[0]).toMatchObject({ sent: true, analyzed: false, late: true })
    expect(analyzeLogs).not.toHaveBeenCalled()
    expect(sendReportEmail.mock.calls.at(-1)[0]).toContain('08시 요약')
  })

  it('할당량 차단 중이면 발송 시각이어도 Gemini를 부르지 않는다', async () => {
    const { listSourcesRaw } = await import('./sources.js')
    const { analyzeLogs } = await import('./analyze.js')
    const { shouldAnalyze } = await import('./schedule.js')
    shouldAnalyze.mockReturnValueOnce({ run: false, reason: 'quota-blocked' })
    listSourcesRaw.mockResolvedValueOnce([mkSource({ id: 's1', recipients: ['a@x.com'] })])
    analyzeLogs.mockClear()

    const res = await request(app()).get(`${base}/tick?hub=cs`).set(CRON)

    expect(res.body.results[0].sent).toBe(true)
    expect(analyzeLogs).not.toHaveBeenCalled()
  })

  it('일시 오류는 차단하지 않는다 — 다음 tick에 그대로 재시도', async () => {
    const { listSourcesRaw, updateSource } = await import('./sources.js')
    const { analyzeLogs } = await import('./analyze.js')
    listSourcesRaw.mockResolvedValueOnce([mkSource({ id: 's1' })])
    analyzeLogs.mockRejectedValueOnce(new Error('[503] unavailable'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await request(app()).get(`${base}/tick?hub=cs`).set(CRON)

    expect(updateSource.mock.calls.find(([, , f]) => f && 'analysis_blocked_until' in f)).toBeUndefined()
    spy.mockRestore()
  })

  it('한 소스가 throw해도 다른 소스는 계속(격리)', async () => {
    const { listSourcesRaw } = await import('./sources.js')
    const { gatherReportData } = await import('./client.js')
    listSourcesRaw.mockResolvedValueOnce([mkSource({ id: 's1' }), mkSource({ id: 's2' })])
    gatherReportData.mockRejectedValueOnce(new Error('conn fail')) // s1만 실패
    const res = await request(app()).get(`${base}/tick?hub=cs`).set(CRON)
    expect(res.status).toBe(200)
    expect(res.body.results).toHaveLength(2)
    expect(res.body.results[0]).toMatchObject({ source_id: 's1', error: expect.stringContaining('conn fail') })
    expect(res.body.results[1].source_id).toBe('s2')
  })

  it('발송·분석 모두 불필요한 소스는 reason과 함께 스킵', async () => {
    const { listSourcesRaw } = await import('./sources.js')
    const { shouldSend, shouldAnalyze } = await import('./schedule.js')
    listSourcesRaw.mockResolvedValueOnce([mkSource({ id: 's1' })])
    shouldSend.mockReturnValueOnce({ send: false, reason: 'not-time' })
    shouldAnalyze.mockReturnValueOnce({ run: false, reason: 'before-hour' })
    const res = await request(app()).get(`${base}/tick?hub=cs`).set(CRON)
    // 발송 사유(not-time)와 분석 사유(before-hour)가 다르므로 둘 다 실린다.
    expect(res.body.results[0]).toEqual({
      source_id: 's1', name: '운영', sent: false, analyzed: false,
      reason: 'not-time', analyze_reason: 'before-hour',
    })
  })

  // 둘 다 건너뛸 때 발송 사유만 싣고 분석 사유를 버리면, 크론 응답만 보는 입장에서는
  // "분석을 왜 안 했나"를 알 수 없다 — 할당량 차단이 'not-time'으로 보인다.
  it('분석을 건너뛴 사유도 함께 싣는다', async () => {
    const { listSourcesRaw } = await import('./sources.js')
    const { shouldSend, shouldAnalyze } = await import('./schedule.js')
    listSourcesRaw.mockResolvedValueOnce([mkSource({ id: 's1' })])
    shouldSend.mockReturnValueOnce({ send: false, reason: 'not-time' })
    shouldAnalyze.mockReturnValueOnce({ run: false, reason: 'quota-blocked' })
    const res = await request(app()).get(`${base}/tick?hub=cs`).set(CRON)
    expect(res.body.results[0]).toMatchObject({ reason: 'not-time', analyze_reason: 'quota-blocked' })
  })

  it('분석 사유가 발송 사유와 같으면 중복해 싣지 않는다', async () => {
    const { listSourcesRaw } = await import('./sources.js')
    const { shouldSend, shouldAnalyze } = await import('./schedule.js')
    listSourcesRaw.mockResolvedValueOnce([mkSource({ id: 's1' })])
    shouldSend.mockReturnValueOnce({ send: false, reason: 'disabled' })
    shouldAnalyze.mockReturnValueOnce({ run: false, reason: 'disabled' })
    const res = await request(app()).get(`${base}/tick?hub=cs`).set(CRON)
    expect(res.body.results[0]).not.toHaveProperty('analyze_reason')
  })

  it('unknown hub 404', async () => {
    const { default: db } = await import('../../db.js')
    const orig = db.single
    db.single = () => Promise.resolve({ data: null, error: null })
    const res = await request(app()).get(`${base}/tick?hub=nope`).set(CRON)
    expect(res.status).toBe(404)
    db.single = orig
  })
})

// 경로 파라미터 형식 가드.
// 예전에는 형식이 틀린 값을 그대로 쿼리에 넘겨 Postgres가 22P02로 던졌고, 그것이
// **500 + 원문 오류**로 나갔다 — 클라이언트 잘못을 서버 오류로 보고하면서
// 내부 스키마(어느 컬럼이 uuid인지)까지 흘렸다.
describe('grafana-reports router — 경로 파라미터 형식', () => {
  it('유형 id가 UUID가 아니면 400이고, 조회를 시도하지 않는다', async () => {
    const { getType } = await import('./logTypes.js')
    const res = await request(app()).get(`${base}/log-types/not-a-uuid?hub=cs`).set(PW)
    expect(res.status).toBe(400)
    expect(getType).not.toHaveBeenCalled()
  })

  it('400 응답은 내부 오류 원문을 담지 않는다', async () => {
    const res = await request(app()).get(`${base}/log-types/not-a-uuid?hub=cs`).set(PW)
    expect(JSON.stringify(res.body)).not.toMatch(/uuid|syntax|postgres/i)
  })

  it('PATCH·DELETE도 같은 가드를 받는다', async () => {
    const { updateType, deleteType } = await import('./logTypes.js')
    expect((await request(app()).patch(`${base}/log-types/nope?hub=cs`).set(PW).send({ note: 'x' })).status).toBe(400)
    expect((await request(app()).delete(`${base}/log-types/nope?hub=cs`).set(PW)).status).toBe(400)
    expect(updateType).not.toHaveBeenCalled()
    expect(deleteType).not.toHaveBeenCalled()
  })

  it('회차 id는 정수여야 한다 — bigint 컬럼이다', async () => {
    const { updateRun } = await import('./logTypes.js')
    const res = await request(app()).patch(`${base}/log-type-runs/abc?hub=cs`).set(PW).send({ note: 'x' })
    expect(res.status).toBe(400)
    expect(updateRun).not.toHaveBeenCalled()
  })
})

// 프로덕션에서 잘못된 source 하나로 함수가 60초를 다 쓰고 504로 죽었다(2026-09-15).
// 원인은 라우트가 resolveSource를 try 밖에서 부르는데 Express 4가 async 거부를 잡지 않는 것.
// 형식 검사로 트리거를 없애고, 안전망으로 매달림 자체를 없앴다.
describe('grafana-reports router — source 파라미터', () => {
  it('형식이 틀리면 400이고, 소스를 조회하지 않는다', async () => {
    const { getSourceRaw } = await import('./sources.js')
    const res = await request(app()).get(`${base}/log-types?hub=cs&source=not-a-uuid`).set(PW)
    expect(res.status).toBe(400)
    expect(getSourceRaw).not.toHaveBeenCalled()
  })

  it('body로 들어와도 같은 검사를 받는다', async () => {
    const res = await request(app()).post(`${base}/analyze?hub=cs`).set(PW).send({ source: 'bad' })
    expect(res.status).toBe(400)
  })

  it('빈 값은 "미지정"으로 본다 — 첫 소스 폴백', async () => {
    const res = await request(app()).get(`${base}/log-types?hub=cs&source=`).set(PW)
    expect(res.status).toBe(200)
  })

  it('예상 못한 오류가 나도 응답은 만들어진다 — 매달리지 않는다', async () => {
    const { getSourceRaw } = await import('./sources.js')
    getSourceRaw.mockRejectedValueOnce(new Error('invalid input syntax for type uuid'))
    const res = await request(app()).get(`${base}/log-types?hub=cs&source=${OTHER_SRC}`).set(PW)
    expect(res.status).toBe(500)
    expect(res.text).not.toMatch(/syntax|uuid/i)
  })
})

// /sources/:id도 uuid 컬럼이다. 이 라우트는 자체 catch가 있어 안전망보다 먼저 잡으므로
// 형식 오류가 그대로 500 + DB 원문으로 나갔다(프로덕션 실측 2026-09-15).
describe('grafana-reports router — /sources/:id 형식', () => {
  it('PUT 형식 오류는 400이고 갱신을 시도하지 않는다', async () => {
    const { updateSource } = await import('./sources.js')
    const res = await request(app()).put(`${base}/sources/not-a-uuid?hub=cs`).set(PW).send({ name: 'x' })
    expect(res.status).toBe(400)
    expect(updateSource).not.toHaveBeenCalled()
  })

  it('DELETE 형식 오류는 400이고 삭제를 시도하지 않는다', async () => {
    const { deleteSource } = await import('./sources.js')
    const res = await request(app()).delete(`${base}/sources/not-a-uuid?hub=cs`).set(PW)
    expect(res.status).toBe(400)
    expect(deleteSource).not.toHaveBeenCalled()
  })

  it('400 본문에 DB 원문을 담지 않는다', async () => {
    const res = await request(app()).put(`${base}/sources/not-a-uuid?hub=cs`).set(PW).send({ name: 'x' })
    expect(res.text).not.toMatch(/syntax|uuid/i)
  })
})
