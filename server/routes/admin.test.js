// server/routes/admin.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

const mockFrom = vi.hoisted(() => vi.fn())
vi.mock('../db.js', () => ({ default: { from: mockFrom } }))

function mockQuery(result) {
  const p = Promise.resolve(result)
  return {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
    then: (resolve, reject) => p.then(resolve, reject),
  }
}


// 응답을 손으로 풀어 주는 가짜 쿼리 — "앞 조회가 끝나기 전에 다음 조회가 시작됐는가"(병렬 여부)를 본다.
function deferredQuery(result) {
  let release
  const p = new Promise((r) => { release = () => r(result) })
  const q = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
    then: (resolve, reject) => p.then(resolve, reject),
  }
  return { q, release }
}
const tick = () => new Promise((r) => setTimeout(r, 0))

const { default: adminRouter } = await import('./admin.js')
const app = express()
app.use(express.json())
app.use('/api/admin', adminRouter)

const AUTH = { 'x-app-password': 'test-password' }
const H1 = '00000000-0000-4000-8000-000000000001' // 허브 id(uuid) — 경로의 :id는 형식 검사를 거친다
const MISSING = '00000000-0000-4000-8000-0000000000ff' // 형식은 맞지만 없는 허브
beforeEach(() => { vi.clearAllMocks(); process.env.APP_PASSWORD = 'test-password' })

describe('GET /api/admin/modules', () => {
  it('등록 모듈 키 목록 반환 (chatbot-monitoring 포함)', async () => {
    const res = await request(app).get('/api/admin/modules').set(AUTH)
    expect(res.status).toBe(200)
    expect(res.body.map(m => m.key)).toContain('chatbot-monitoring')
  })
  it('인증 없으면 401', async () => {
    expect((await request(app).get('/api/admin/modules')).status).toBe(401)
  })
})

describe('PUT /api/admin/hubs/:id/password — 허브 비밀번호 설정/해제', () => {
  it('인증 없으면 401', async () => {
    expect((await request(app).put(`/api/admin/hubs/${H1}/password`).send({ password: 'x' })).status).toBe(401)
  })

  it('비밀번호를 해시로 저장한다 — 평문이 DB로 가지 않는다', async () => {
    const q = mockQuery({ data: [{ id: 'h1', key: 'cs', password_hash: 'scrypt$aa$bb' }], error: null })
    mockFrom.mockReturnValueOnce(q)
    const res = await request(app).put(`/api/admin/hubs/${H1}/password`).set(AUTH).send({ password: '평문비밀' })
    expect(res.status).toBe(200)
    const [patch] = q.update.mock.calls[0]
    expect(patch.password_hash).toMatch(/^scrypt\$/)
    expect(patch.password_hash).not.toContain('평문비밀')
  })

  it('빈 문자열이면 해제(NULL) — 그 허브는 공개가 된다', async () => {
    const q = mockQuery({ data: [{ id: 'h1', key: 'cs', password_hash: null }], error: null })
    mockFrom.mockReturnValueOnce(q)
    const res = await request(app).put(`/api/admin/hubs/${H1}/password`).set(AUTH).send({ password: '' })
    expect(res.status).toBe(200)
    expect(q.update).toHaveBeenCalledWith({ password_hash: null })
    expect(res.body.has_password).toBe(false)
  })

  it('null이어도 해제', async () => {
    const q = mockQuery({ data: [{ id: 'h1', password_hash: null }], error: null })
    mockFrom.mockReturnValueOnce(q)
    await request(app).put(`/api/admin/hubs/${H1}/password`).set(AUTH).send({ password: null })
    expect(q.update).toHaveBeenCalledWith({ password_hash: null })
  })

  it('문자열이 아니면 400', async () => {
    expect((await request(app).put(`/api/admin/hubs/${H1}/password`).set(AUTH).send({ password: 123 })).status).toBe(400)
  })

  it('없는 허브면 404', async () => {
    mockFrom.mockReturnValueOnce(mockQuery({ data: [], error: null }))
    expect((await request(app).put(`/api/admin/hubs/${MISSING}/password`).set(AUTH).send({ password: 'x' })).status).toBe(404)
  })

  it('응답에 해시를 담지 않는다 — has_password 불리언만', async () => {
    mockFrom.mockReturnValueOnce(mockQuery({ data: [{ id: 'h1', key: 'cs', password_hash: 'scrypt$aa$bb' }], error: null }))
    const res = await request(app).put(`/api/admin/hubs/${H1}/password`).set(AUTH).send({ password: 'x' })
    expect(res.body).not.toHaveProperty('password_hash')
    expect(res.body.has_password).toBe(true)
  })
})

describe('허브 응답에서 해시 제거', () => {
  it('GET /hubs는 password_hash를 빼고 has_password를 준다', async () => {
    mockFrom.mockReturnValueOnce(mockQuery({
      data: [
        { id: 'h1', key: 'cs', name: 'CS', password_hash: 'scrypt$aa$bb' },
        { id: 'h2', key: 'ops', name: 'Ops', password_hash: null },
      ],
      error: null,
    }))
    const res = await request(app).get('/api/admin/hubs').set(AUTH)
    expect(JSON.stringify(res.body)).not.toContain('scrypt$')
    expect(res.body.map(h => h.has_password)).toEqual([true, false])
    expect(res.body[0]).not.toHaveProperty('password_hash')
  })
})

describe('GET /api/admin/hubs', () => {
  it('허브 목록 반환', async () => {
    mockFrom.mockReturnValueOnce(mockQuery({ data: [{ id: 'h1', key: 'delivery', name: 'Delivery' }], error: null }))
    const res = await request(app).get('/api/admin/hubs').set(AUTH)
    expect(res.status).toBe(200)
    expect(res.body[0].key).toBe('delivery')
  })
})

describe('POST /api/admin/hubs', () => {
  it('key/name 누락이면 400', async () => {
    expect((await request(app).post('/api/admin/hubs').set(AUTH).send({ key: 'x' })).status).toBe(400)
  })
  it('허브 생성 201 + settings upsert', async () => {
    const hubsQ = mockQuery({ data: { id: 'h2', key: 'ops', name: 'Ops' }, error: null })
    const settingsQ = mockQuery({ data: null, error: null })
    mockFrom.mockReturnValueOnce(hubsQ).mockReturnValueOnce(settingsQ)
    const res = await request(app).post('/api/admin/hubs').set(AUTH).send({ key: 'ops', name: 'Ops', password: 'ops-pw' })
    expect(res.status).toBe(201)
    expect(settingsQ.upsert).toHaveBeenCalledWith({ hub_id: 'h2' }, { onConflict: 'hub_id' })
  })
  it('중복 key면 409', async () => {
    mockFrom.mockReturnValueOnce(mockQuery({ data: null, error: { code: '23505' } }))
    expect((await request(app).post('/api/admin/hubs').set(AUTH).send({ key: 'delivery', name: 'D', password: 'p' })).status).toBe(409)
  })

  // 잠그는 것을 잊어 허브가 공개로 태어나는 사고를 막는다. 공개로 만드는 것 자체는
  // 허용하되(사내 전용 허브도 있다), **의식적으로 그렇게 말해야** 한다.
  describe('기본 잠금 — 공개 생성은 명시 확인이 필요하다', () => {
    it('비밀번호도 공개 확인도 없으면 400이고 허브를 만들지 않는다', async () => {
      const res = await request(app).post('/api/admin/hubs').set(AUTH).send({ key: 'ops', name: 'Ops' })
      expect(res.status).toBe(400)
      expect(res.body.error).toBe('PUBLIC_ACK_REQUIRED')
      expect(mockFrom).not.toHaveBeenCalled()
    })

    it('비밀번호를 주면 잠긴 허브로 만든다 — 해시로 저장하고 응답에 싣지 않는다', async () => {
      const hubsQ = mockQuery({ data: { id: 'h3', key: 'ops', name: 'Ops' }, error: null })
      mockFrom.mockReturnValueOnce(hubsQ).mockReturnValueOnce(mockQuery({ data: null, error: null }))
      const res = await request(app).post('/api/admin/hubs').set(AUTH).send({ key: 'ops', name: 'Ops', password: 'ops-pw' })
      expect(res.status).toBe(201)
      const inserted = hubsQ.insert.mock.calls[0][0]
      expect(inserted.password_hash).toMatch(/^scrypt\$/)
      expect(JSON.stringify(res.body)).not.toContain('ops-pw')
      expect(JSON.stringify(res.body)).not.toContain('scrypt$')
    })

    it('public_ack가 true면 공개 허브로 만든다', async () => {
      const hubsQ = mockQuery({ data: { id: 'h4', key: 'ops', name: 'Ops' }, error: null })
      mockFrom.mockReturnValueOnce(hubsQ).mockReturnValueOnce(mockQuery({ data: null, error: null }))
      const res = await request(app).post('/api/admin/hubs').set(AUTH).send({ key: 'ops', name: 'Ops', public_ack: true })
      expect(res.status).toBe(201)
      expect(hubsQ.insert.mock.calls[0][0].password_hash).toBeUndefined()
    })

    it('비밀번호가 공백뿐이면 비밀번호로 치지 않는다', async () => {
      const res = await request(app).post('/api/admin/hubs').set(AUTH).send({ key: 'ops', name: 'Ops', password: '   ' })
      expect(res.status).toBe(400)
      expect(res.body.error).toBe('PUBLIC_ACK_REQUIRED')
    })

    it('key/name 검증이 먼저다 — 공개 확인이 있어도 key가 틀리면 400', async () => {
      const res = await request(app).post('/api/admin/hubs').set(AUTH).send({ key: 'Bad Key', name: 'X', public_ack: true })
      expect(res.status).toBe(400)
      expect(res.body.error).not.toBe('PUBLIC_ACK_REQUIRED')
    })
  })
})

describe('hub_features', () => {
  it('GET features: 허브 매트릭스 반환', async () => {
    mockFrom
      .mockReturnValueOnce(mockQuery({ data: { id: 'h1', key: 'delivery', name: 'Delivery' }, error: null })) // resolveHub
      .mockReturnValueOnce(mockQuery({ data: [{ feature_key: 'chatbot-monitoring', enabled: true, config: {}, sort_order: 0 }], error: null }))
    const res = await request(app).get('/api/admin/hubs/delivery/features').set(AUTH)
    expect(res.status).toBe(200)
    expect(res.body.features[0].feature_key).toBe('chatbot-monitoring')
  })

  it('PUT feature: 알 수 없는 모듈이면 400', async () => {
    const res = await request(app).put('/api/admin/hubs/delivery/features/nope').set(AUTH).send({ enabled: false })
    expect(res.status).toBe(400)
  })

  it('PUT feature: 토글 upsert', async () => {
    const upQ = mockQuery({ data: { hub_id: 'h1', feature_key: 'chatbot-monitoring', enabled: false }, error: null })
    mockFrom
      .mockReturnValueOnce(mockQuery({ data: { id: 'h1', key: 'delivery' }, error: null })) // resolveHub
      .mockReturnValueOnce(upQ)
    const res = await request(app).put('/api/admin/hubs/delivery/features/chatbot-monitoring').set(AUTH).send({ enabled: false })
    expect(res.status).toBe(200)
    expect(upQ.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ hub_id: 'h1', feature_key: 'chatbot-monitoring', enabled: false }),
      { onConflict: 'hub_id,feature_key' },
    )
  })

  // 서버 레지스트리 기반 검증이라, sheet-to-schema가 등록되지 않으면 여기서 400 unknown module로
  // 막혀 어드민 토글 자체가 동작하지 않는다.
  it('PUT feature: sheet-to-schema도 알려진 모듈로 통과한다', async () => {
    const hubQ = mockQuery({ data: { id: 'h1', key: 'cs', name: 'CS' }, error: null })
    const featQ = mockQuery({ data: { hub_id: 'h1', feature_key: 'sheet-to-schema', enabled: true }, error: null })
    mockFrom.mockReturnValueOnce(hubQ).mockReturnValueOnce(featQ)
    const res = await request(app).put('/api/admin/hubs/cs/features/sheet-to-schema').set(AUTH).send({ enabled: true })
    expect(res.status).toBe(200)
  })

  it('PUT feature: 알 수 없는 모듈이면 400', async () => {
    const res = await request(app).put('/api/admin/hubs/cs/features/nope').set(AUTH).send({ enabled: true })
    expect(res.status).toBe(400)
  })

  it('PUT feature: 알 수 없는 hub면 404', async () => {
    mockFrom.mockReturnValueOnce(mockQuery({ data: null, error: null })) // resolveHub → null
    const res = await request(app).put('/api/admin/hubs/nope/features/chatbot-monitoring').set(AUTH).send({ enabled: true })
    expect(res.status).toBe(404)
  })
})

describe('GET /api/admin/overview (모듈 레지스트리 순회)', () => {
  it('허브 × enabled 모듈 요약 집계', async () => {
    mockFrom
      // 1) hubs
      .mockReturnValueOnce(mockQuery({ data: [{ id: 'h1', key: 'delivery', name: 'Delivery', enabled: true }], error: null }))
      // 2) hub_features
      .mockReturnValueOnce(mockQuery({ data: [{ hub_id: 'h1', feature_key: 'chatbot-monitoring', enabled: true }], error: null }))
      // 3) chatbot overview → hub_chatbots
      .mockReturnValueOnce(mockQuery({ data: [{ id: 'b1', name: '샘플봇', enabled: true, category: null }], error: null }))
      // 4) chatbot overview → hub_chatbot_check_log
      .mockReturnValueOnce(mockQuery({ data: [{ chatbot_id: 'b1', ok: false, checked_at: '2026-07-21T00:00:00Z' }], error: null }))
    const res = await request(app).get('/api/admin/overview').set(AUTH)
    expect(res.status).toBe(200)
    expect(res.body[0].hub.key).toBe('delivery')
    const feat = res.body[0].features.find(f => f.key === 'chatbot-monitoring')
    expect(feat.summary.bot_count).toBe(1)
    expect(feat.summary.failing_count).toBe(1)
  })

  // 서버 파트 없는 무상태 툴(sheet-to-schema) — 레지스트리에 있으니 features에 나타나야 하고
  // overview가 없으니 summary는 빈 객체다(어드민 StatRow 기본 분기 → "요약 없음").
  it('overview 없는 모듈(sheet-to-schema)도 features에 { key, summary: {} }로 나타난다', async () => {
    mockFrom
      .mockReturnValueOnce(mockQuery({ data: [{ id: 'h1', key: 'cs', name: 'CS', enabled: true }], error: null }))
      .mockReturnValueOnce(mockQuery({ data: [{ hub_id: 'h1', feature_key: 'sheet-to-schema', enabled: true }], error: null }))
    const res = await request(app).get('/api/admin/overview').set(AUTH)
    expect(res.status).toBe(200)
    expect(res.body[0].features).toEqual([{ key: 'sheet-to-schema', summary: {} }])
  })

  it('모듈이 꺼진 허브는 features 비어있음', async () => {
    mockFrom
      .mockReturnValueOnce(mockQuery({ data: [{ id: 'h9', key: 'empty', name: 'Empty', enabled: true }], error: null }))
      .mockReturnValueOnce(mockQuery({ data: [], error: null })) // hub_features 없음
    const res = await request(app).get('/api/admin/overview').set(AUTH)
    expect(res.status).toBe(200)
    expect(res.body[0].features).toEqual([])
  })

  // 2026-11-12 성능: 허브 × 모듈 요약을 하나씩 기다리면 외부판(Supabase REST, 조회당 수십 ms)에서 조회 수만큼 늘어난다.
  it('허브 목록·플래그를 동시에, 허브별 모듈 요약도 동시에 조회한다', async () => {
    const hubs = deferredQuery({ data: [{ id: 'h1', key: 'a', name: 'A', enabled: true }, { id: 'h2', key: 'b', name: 'B', enabled: true }], error: null })
    const flags = deferredQuery({ data: [{ hub_id: 'h1', feature_key: 'mailer', enabled: true }, { hub_id: 'h2', feature_key: 'mailer', enabled: true }], error: null })
    const jobs1 = deferredQuery({ data: [], error: null })
    const jobs2 = deferredQuery({ data: [], error: null })
    mockFrom.mockReturnValueOnce(hubs.q).mockReturnValueOnce(flags.q).mockReturnValueOnce(jobs1.q).mockReturnValueOnce(jobs2.q)
    const pending = request(app).get('/api/admin/overview').set(AUTH).then((r) => r)
    for (let i = 0; i < 20 && mockFrom.mock.calls.length < 2; i++) await tick()
    expect(mockFrom).toHaveBeenCalledTimes(2) // hubs 응답 전에 hub_features도 이미 출발
    hubs.release(); flags.release()
    for (let i = 0; i < 20 && mockFrom.mock.calls.length < 4; i++) await tick()
    expect(mockFrom).toHaveBeenCalledTimes(4) // 허브 2개의 mailer 요약이 함께 출발
    jobs1.release(); jobs2.release()
    const res = await pending
    expect(res.status).toBe(200)
    expect(res.body.map((x) => x.hub.key)).toEqual(['a', 'b']) // 순서는 허브 목록 그대로
  })
})

describe('DELETE /api/admin/hubs/:id', () => {
  it('삭제 성공', async () => {
    mockFrom.mockReturnValueOnce(mockQuery({ data: [{ id: 'h1' }], error: null }))
    const res = await request(app).delete(`/api/admin/hubs/${H1}`).set(AUTH)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })
  })
  it('없는 id면 404', async () => {
    mockFrom.mockReturnValueOnce(mockQuery({ data: [], error: null }))
    const res = await request(app).delete(`/api/admin/hubs/${MISSING}`).set(AUTH)
    expect(res.status).toBe(404)
  })
  it('인증 없으면 401', async () => {
    expect((await request(app).delete(`/api/admin/hubs/${H1}`)).status).toBe(401)
  })
})

describe('GET /api/admin/activity', () => {
  it('이벤트/자동화 병합 + severity 매핑 + 최신순 정렬', async () => {
    mockFrom
      // 1) hubs
      .mockReturnValueOnce(mockQuery({ data: [{ id: 'h1', key: 'delivery', name: 'Delivery' }], error: null }))
      // 2) hub_features
      .mockReturnValueOnce(mockQuery({
        data: [
          { hub_id: 'h1', feature_key: 'chatbot-monitoring', enabled: true },
          { hub_id: 'h1', feature_key: 'mailer', enabled: true },
        ], error: null,
      }))
      // 3) hub_chatbots
      .mockReturnValueOnce(mockQuery({ data: [{ id: 'b1', hub_id: 'h1', name: '샘플봇' }], error: null }))
      // 4) hub_chatbot_check_log
      .mockReturnValueOnce(mockQuery({
        data: [{ chatbot_id: 'b1', hub_id: 'h1', ok: false, detail: '접속 타임아웃 발생', checked_at: '2026-07-23T01:00:00Z' }],
        error: null,
      }))
      // 5) grafana_report_settings
      .mockReturnValueOnce(mockQuery({
        data: [{
          hub_id: 'h1',
          last_analysis: { summary: '에러 로그 요약입니다', generated_at: '2026-07-22T09:00:00Z' },
          last_analysis_date: '2026-07-22', last_sent_date: '2026-07-22T09:05:00Z',
        }], error: null,
      }))
      // 6) mail_jobs
      .mockReturnValueOnce(mockQuery({ data: [{ id: 'j1', hub_id: 'h1', name: '뉴스레터' }], error: null }))
      // 7) send_log
      .mockReturnValueOnce(mockQuery({ data: [{ job_id: 'j1', ok: true, error: null, sent_at: '2026-07-23T02:00:00Z' }], error: null }))

    const res = await request(app).get('/api/admin/activity').set(AUTH)
    expect(res.status).toBe(200)

    expect(res.body.events).toHaveLength(3)
    expect(res.body.events[0].type).toBe('mailer') // 가장 최근(02:00)이 맨 앞
    const chatbotEvt = res.body.events.find(e => e.type === 'chatbot')
    expect(chatbotEvt.severity).toBe('crit')
    expect(chatbotEvt.title).toBe('샘플봇 점검 실패')
    expect(chatbotEvt.hubKey).toBe('delivery')
    const grafanaEvt = res.body.events.find(e => e.type === 'grafana')
    expect(grafanaEvt.severity).toBe('good')
    expect(grafanaEvt.detail).toBe('에러 로그 요약입니다')
    const mailerEvt = res.body.events.find(e => e.type === 'mailer')
    expect(mailerEvt.severity).toBe('good')
    expect(mailerEvt.title).toBe('뉴스레터 발송')

    expect(res.body.automations).toHaveLength(2)
    const chatbotAuto = res.body.automations.find(a => a.module === 'chatbot-monitoring')
    expect(chatbotAuto).toMatchObject({ hubKey: 'delivery', label: '챗봇 점검', ok: false, lastRun: '2026-07-23T01:00:00Z' })
    const mailerAuto = res.body.automations.find(a => a.module === 'mailer')
    expect(mailerAuto).toMatchObject({ hubKey: 'delivery', label: '메일 발송', ok: true, lastRun: '2026-07-23T02:00:00Z' })
  })

  it('데이터가 비어 있어도 500 없이 빈 배열 반환', async () => {
    mockFrom
      .mockReturnValueOnce(mockQuery({ data: [], error: null })) // hubs
      .mockReturnValueOnce(mockQuery({ data: [], error: null })) // hub_features
      .mockReturnValueOnce(mockQuery({ data: [], error: null })) // hub_chatbots
      .mockReturnValueOnce(mockQuery({ data: [], error: null })) // hub_chatbot_check_log
      .mockReturnValueOnce(mockQuery({ data: [], error: null })) // grafana_report_settings
      .mockReturnValueOnce(mockQuery({ data: [], error: null })) // mail_jobs (send_log는 job 없으면 스킵)
    const res = await request(app).get('/api/admin/activity').set(AUTH)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ events: [], automations: [] })
  })

  it('한 소스가 에러여도 전체는 500이 아님', async () => {
    mockFrom
      .mockReturnValueOnce(mockQuery({ data: [{ id: 'h1', key: 'delivery', name: 'Delivery' }], error: null })) // hubs
      .mockReturnValueOnce(mockQuery({ data: null, error: { message: 'boom' } })) // hub_features 에러
      .mockReturnValueOnce(mockQuery({ data: [], error: null })) // hub_chatbots
      .mockReturnValueOnce(mockQuery({ data: [], error: null })) // hub_chatbot_check_log
      .mockReturnValueOnce(mockQuery({ data: [], error: null })) // grafana_report_settings
      .mockReturnValueOnce(mockQuery({ data: [], error: null })) // mail_jobs
    const res = await request(app).get('/api/admin/activity').set(AUTH)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ events: [], automations: [] })
  })


  it('서로 기다릴 필요 없는 6개 소스를 동시에 조회한다', async () => {
    const ds = Array.from({ length: 6 }, () => deferredQuery({ data: [], error: null }))
    ds.forEach((d) => mockFrom.mockReturnValueOnce(d.q))
    const pending = request(app).get('/api/admin/activity').set(AUTH).then((r) => r)
    for (let i = 0; i < 20 && mockFrom.mock.calls.length < 6; i++) await tick()
    expect(mockFrom).toHaveBeenCalledTimes(6)
    ds.forEach((d) => d.release())
    const res = await pending
    expect(res.body).toEqual({ events: [], automations: [] })
  })

  it('인증 없으면 401', async () => {
    expect((await request(app).get('/api/admin/activity')).status).toBe(401)
  })
})

// 2026-11-09 모듈 보안 레벨 — 레벨 조정은 마스터 키 관문 안에서만. 행이 없으면 코드 기본값.
describe('GET/PUT /api/admin/security — 모듈 보안 레벨', () => {
  it('인증 없으면 401', async () => {
    expect((await request(app).get('/api/admin/security')).status).toBe(401)
    expect((await request(app).put('/api/admin/security/mailer').send({ level: 'L1', reason: 'x' })).status).toBe(401)
  })

  it('GET: DB 행이 있으면 그 레벨, 없으면 기본값', async () => {
    mockFrom.mockReturnValueOnce(mockQuery({ data: [{ module_key: 'mailer', level: 'L2', reason: '사내 발송만', updated_at: 't' }], error: null }))
    const res = await request(app).get('/api/admin/security').set(AUTH)
    expect(res.status).toBe(200)
    const byKey = Object.fromEntries(res.body.modules.map(m => [m.key, m]))
    expect(byKey.mailer).toMatchObject({ defaultLevel: 'L3', level: 'L2', reason: '사내 발송만' })
    expect(byKey['sheet-to-schema']).toMatchObject({ defaultLevel: 'L0', level: 'L0', reason: null })
  })

  it('GET: DB 오류면 500 — 백오피스는 기본값으로 판정한다', async () => {
    mockFrom.mockReturnValueOnce(mockQuery({ data: null, error: { message: 'relation does not exist' } }))
    expect((await request(app).get('/api/admin/security').set(AUTH)).status).toBe(500)
  })

  it('기본보다 낮추는데 사유가 없으면 400 REASON_REQUIRED, DB에 쓰지 않는다', async () => {
    const res = await request(app).put('/api/admin/security/mailer').set(AUTH).send({ level: 'L1', reason: '  ' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('REASON_REQUIRED')
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('사유와 함께 낮추면 저장한다', async () => {
    const q = mockQuery({ data: null, error: null })
    mockFrom.mockReturnValueOnce(q)
    const res = await request(app).put('/api/admin/security/mailer').set(AUTH).send({ level: 'L1', reason: '사내만' })
    expect(res.status).toBe(200)
    expect(q.upsert.mock.calls[0][0]).toMatchObject({ module_key: 'mailer', level: 'L1', reason: '사내만' })
    expect(res.body).toMatchObject({ key: 'mailer', defaultLevel: 'L3', level: 'L1', reason: '사내만' })
  })

  it('올리는 것은 사유 없이 저장한다', async () => {
    const q = mockQuery({ data: null, error: null })
    mockFrom.mockReturnValueOnce(q)
    const res = await request(app).put('/api/admin/security/sheet-to-schema').set(AUTH).send({ level: 'L2' })
    expect(res.status).toBe(200)
    expect(q.upsert.mock.calls[0][0]).toMatchObject({ module_key: 'sheet-to-schema', level: 'L2' })
  })

  it('기본값으로 되돌리면 행을 지운다', async () => {
    const q = mockQuery({ data: null, error: null })
    mockFrom.mockReturnValueOnce(q)
    const res = await request(app).put('/api/admin/security/mailer').set(AUTH).send({ level: 'L3' })
    expect(res.status).toBe(200)
    expect(q.delete).toHaveBeenCalled()
    expect(q.eq).toHaveBeenCalledWith('module_key', 'mailer')
    expect(q.upsert).not.toHaveBeenCalled()
    expect(res.body).toMatchObject({ level: 'L3', reason: null })
  })

  it('모르는 모듈·레벨·너무 긴 사유는 400', async () => {
    expect((await request(app).put('/api/admin/security/nope').set(AUTH).send({ level: 'L1' })).status).toBe(400)
    expect((await request(app).put('/api/admin/security/mailer').set(AUTH).send({ level: 'L7' })).status).toBe(400)
    expect((await request(app).put('/api/admin/security/mailer').set(AUTH).send({ level: 'L1', reason: 'x'.repeat(201) })).status).toBe(400)
  })
})

describe('PUT /api/admin/hubs/:id/security-ack — 확인된 예외', () => {
  it('인증 없으면 401', async () => {
    expect((await request(app).put(`/api/admin/hubs/${H1}/security-ack`).send({ level: 'L2' })).status).toBe(401)
  })

  it('확인 시점의 요구 레벨을 기록한다', async () => {
    const q = mockQuery({ data: [{ id: 'h1', key: 'cs', password_hash: null, security_ack_level: 'L2' }], error: null })
    mockFrom.mockReturnValueOnce(q)
    const res = await request(app).put(`/api/admin/hubs/${H1}/security-ack`).set(AUTH).send({ level: 'L2' })
    expect(res.status).toBe(200)
    expect(q.update).toHaveBeenCalledWith({ security_ack_level: 'L2' })
    expect(res.body.password_hash).toBeUndefined()
  })

  it('null이면 예외 해제', async () => {
    const q = mockQuery({ data: [{ id: 'h1' }], error: null })
    mockFrom.mockReturnValueOnce(q)
    await request(app).put(`/api/admin/hubs/${H1}/security-ack`).set(AUTH).send({ level: null })
    expect(q.update).toHaveBeenCalledWith({ security_ack_level: null })
  })

  it('레벨이 아니면 400, 없는 허브면 404', async () => {
    expect((await request(app).put(`/api/admin/hubs/${H1}/security-ack`).set(AUTH).send({ level: 'x' })).status).toBe(400)
    mockFrom.mockReturnValueOnce(mockQuery({ data: [], error: null }))
    expect((await request(app).put(`/api/admin/hubs/${H1}/security-ack`).set(AUTH).send({ level: 'L2' })).status).toBe(404)
  })

  it('비밀번호를 설정하면 예외 기록을 지운다 — 비밀번호 저장과는 별도 갱신', async () => {
    const pw = mockQuery({ data: [{ id: 'h1', password_hash: 'scrypt$a$b' }], error: null })
    const ack = mockQuery({ data: null, error: null })
    mockFrom.mockReturnValueOnce(pw).mockReturnValueOnce(ack)
    const res = await request(app).put(`/api/admin/hubs/${H1}/password`).set(AUTH).send({ password: '새비번' })
    expect(res.status).toBe(200)
    expect(pw.update.mock.calls[0][0]).not.toHaveProperty('security_ack_level')
    expect(ack.update).toHaveBeenCalledWith({ security_ack_level: null })
  })

  // 리뷰 지적(Critical): 마이그레이션 전 배포 구간에 열이 없으면 비밀번호 설정까지 깨졌다 —
  // 팝업·배너가 안내하는 해결책이 바로 비밀번호 설정이므로, 예외 지우기는 실패해도 넘어간다.
  it('security_ack_level 열이 없어도(마이그레이션 전) 비밀번호는 설정된다', async () => {
    const pw = mockQuery({ data: [{ id: 'h1', password_hash: 'scrypt$a$b' }], error: null })
    const ack = mockQuery({ data: null, error: { code: 'PGRST204', message: "Could not find the 'security_ack_level' column" } })
    mockFrom.mockReturnValueOnce(pw).mockReturnValueOnce(ack)
    const res = await request(app).put(`/api/admin/hubs/${H1}/password`).set(AUTH).send({ password: '새비번' })
    expect(res.status).toBe(200)
    expect(res.body.has_password).toBe(true)
  })

  it('비밀번호 해제는 예외 기록을 건드리지 않는다', async () => {
    const pw = mockQuery({ data: [{ id: 'h1', password_hash: null }], error: null })
    mockFrom.mockReturnValueOnce(pw)
    await request(app).put(`/api/admin/hubs/${H1}/password`).set(AUTH).send({ password: '' })
    expect(mockFrom).toHaveBeenCalledTimes(1)
  })

  it('열이 없으면(마이그레이션 전) 예외 저장은 500 — 화면은 실패 토스트', async () => {
    mockFrom.mockReturnValueOnce(mockQuery({ data: null, error: { code: 'PGRST204', message: 'column missing' } }))
    expect((await request(app).put(`/api/admin/hubs/${H1}/security-ack`).set(AUTH).send({ level: 'L2' })).status).toBe(500)
  })

  it('overview의 hub에 security_ack_level이 실린다', async () => {
    mockFrom
      .mockReturnValueOnce(mockQuery({ data: [{ id: 'h1', key: 'cs', name: 'CS', enabled: true, security_ack_level: 'L2' }], error: null }))
      .mockReturnValueOnce(mockQuery({ data: [], error: null }))
    const res = await request(app).get('/api/admin/overview').set(AUTH)
    expect(res.body[0].hub.security_ack_level).toBe('L2')
  })
})

// 2026-11-09·11-10 QA F1 — uuid가 아닌 :id가 DB까지 가서 500 + Postgres 원문(invalid input syntax for type uuid)이 났다.
describe('/api/admin/hubs/:id — id 형식', () => {
  const calls = [
    ['patch', '/api/admin/hubs/not-a-uuid', { name: 'x' }],
    ['put', '/api/admin/hubs/not-a-uuid/password', { password: 'x' }],
    ['put', '/api/admin/hubs/not-a-uuid/security-ack', { level: 'L2' }],
    ['delete', '/api/admin/hubs/not-a-uuid', undefined],
  ]
  it.each(calls)('%s %s → 404, DB를 부르지 않는다', async (verb, path, body) => {
    const res = await request(app)[verb](path).set(AUTH).send(body)
    expect(res.status).toBe(404)
    expect(JSON.stringify(res.body)).not.toMatch(/uuid|syntax/i)
    expect(mockFrom).not.toHaveBeenCalled()
  })
  it('인증이 먼저다 — 키 없으면 401', async () => {
    expect((await request(app).put('/api/admin/hubs/not-a-uuid/security-ack').send({ level: 'L2' })).status).toBe(401)
  })
})
