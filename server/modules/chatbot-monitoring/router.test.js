// server/routes/chatbot.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

const mockFrom = vi.hoisted(() => vi.fn())
vi.mock('../../db.js', () => ({ default: { from: mockFrom } }))

const HUB_ID = 'hub-delivery'

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

// 라우트는 먼저 db.from('hubs')로 hub_id를 해석한 뒤 hub_* 테이블을 쿼리한다.
// 테이블명으로 디스패치: 'hubs'는 항상 delivery hub_id를 반환하고,
// 그 외 테이블은 각 테스트가 큐잉한 순서대로 반환한다.
let queued = []
function queue(...qs) { queued.push(...qs) }
mockFrom.mockImplementation((table) => {
  if (table === 'hubs') return mockQuery({ data: { id: HUB_ID }, error: null })
  return queued.shift() ?? mockQuery({ data: null, error: null })
})

const { default: chatbotRouter } = await import('./router.js')
const { hashPassword } = await import('../../lib/hubPassword.js')
const app = express()
app.use(express.json())
app.use('/api/chatbot', chatbotRouter)

const AUTH = { 'x-app-password': 'test-password' }

beforeEach(() => {
  vi.clearAllMocks()
  queued = []
  mockFrom.mockImplementation((table) => {
    if (table === 'hubs') return mockQuery({ data: { id: HUB_ID }, error: null })
    return queued.shift() ?? mockQuery({ data: null, error: null })
  })
  process.env.APP_PASSWORD = 'test-password'
})

// 인증 경계: 이 모듈 API는 **대상 허브의 비밀번호**를 요구한다(판정 자체는
// server/lib/hubAuth.test.js). 여기서는 미들웨어가 걸려 있는지만 확인한다.
// 자동 트리거(dispatch)의 Bearer CRON_SECRET은 별개 비밀이며 아래에서 따로 검증한다.
describe('인증 경계 — 허브 비밀번호', () => {
  const CS_HASH = hashPassword('cs-pw')
  const lockHub = () => mockFrom.mockImplementation((table) => (
    table === 'hubs'
      ? mockQuery({ data: { id: HUB_ID, key: 'delivery', name: 'Delivery', password_hash: CS_HASH }, error: null })
      : queued.shift() ?? mockQuery({ data: null, error: null })
  ))

  it('비밀번호 없는 허브는 공개 — 401이 아니다', async () => {
    queue(mockQuery({ data: [], error: null }), mockQuery({ data: [], error: null }))
    expect((await request(app).get('/api/chatbot/bots')).status).not.toBe(401)
  })

  it('비밀번호가 걸린 허브는 401', async () => {
    lockHub()
    const res = await request(app).get('/api/chatbot/bots')
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('HUB_PASSWORD_REQUIRED')
  })

  it('맞는 허브 비밀번호면 통과', async () => {
    lockHub()
    queue(mockQuery({ data: [], error: null }), mockQuery({ data: [], error: null }))
    expect((await request(app).get('/api/chatbot/bots').set('x-hub-password', 'cs-pw')).status).toBe(200)
  })
})

describe('GET /api/chatbot/bots', () => {

  it('봇 목록 + recent_checks(오래된순) 병합 + hub_id 스코프', async () => {
    const botsQ = mockQuery({ data: [{ id: 'b1', name: '샘플봇' }, { id: 'b2', name: 'FAQ' }], error: null })
    queue(botsQ, mockQuery({
      data: [
        { chatbot_id: 'b1', ok: false, detail: 'timeout', duration_ms: 60000, checked_at: '2026-06-10T00:00:00Z' },
        { chatbot_id: 'b1', ok: true, detail: null, duration_ms: 3000, checked_at: '2026-06-09T00:00:00Z' },
      ],
      error: null,
    }))
    const res = await request(app).get('/api/chatbot/bots').set(AUTH)
    expect(res.status).toBe(200)
    expect(res.body[0].recent_checks.map(c => c.ok)).toEqual([true, false])
    expect(res.body[1].recent_checks).toEqual([])
    expect(botsQ.eq).toHaveBeenCalledWith('hub_id', HUB_ID)
  })

  it('알 수 없는 hub면 404', async () => {
    mockFrom.mockImplementationOnce((table) => {
      if (table === 'hubs') return mockQuery({ data: null, error: { message: 'not found' } })
      return mockQuery({ data: null, error: null })
    })
    const res = await request(app).get('/api/chatbot/bots?hub=nope').set(AUTH)
    expect(res.status).toBe(404)
  })

  it('check_log 조회 실패해도 봇 목록은 반환 (best-effort)', async () => {
    queue(mockQuery({ data: [{ id: 'b1' }], error: null }), mockQuery({ data: null, error: { message: 'no table' } }))
    const res = await request(app).get('/api/chatbot/bots').set(AUTH)
    expect(res.status).toBe(200)
    expect(res.body[0].recent_checks).toEqual([])
  })
})

describe('POST /api/chatbot/bots', () => {
  it('봇 생성 201 + hub_id 주입', async () => {
    const bot = { name: '샘플봇', url: 'https://x.y', scenario: [{ say: '안녕', expect: '도와' }] }
    const q = mockQuery({ data: { id: 'b1', ...bot }, error: null })
    queue(q)
    const res = await request(app).post('/api/chatbot/bots').set(AUTH).send(bot)
    expect(res.status).toBe(201)
    expect(res.body.name).toBe('샘플봇')
    expect(q.insert).toHaveBeenCalledWith(expect.objectContaining({ hub_id: HUB_ID }))
  })

  it('category 정규화: 공백/빈값은 null로 insert', async () => {
    const q = mockQuery({ data: { id: 'b1' }, error: null })
    queue(q)
    await request(app).post('/api/chatbot/bots').set(AUTH)
      .send({ name: 'x', url: 'https://x.y', scenario: [], category: '  ' })
    expect(q.insert).toHaveBeenCalledWith(expect.objectContaining({ category: null }))
  })

  it('category 트림 후 저장', async () => {
    const q = mockQuery({ data: { id: 'b1' }, error: null })
    queue(q)
    await request(app).post('/api/chatbot/bots').set(AUTH)
      .send({ name: 'x', url: 'https://x.y', scenario: [], category: ' 예약 ' })
    expect(q.insert).toHaveBeenCalledWith(expect.objectContaining({ category: '예약' }))
  })
})

describe('PATCH /api/chatbot/bots/:id', () => {
  it('허용되지 않은 필드만 있으면 400', async () => {
    const res = await request(app).patch('/api/chatbot/bots/b1').set(AUTH).send({ id: 'hack' })
    expect(res.status).toBe(400)
  })

  it('enabled 토글 성공 + hub_id 가드', async () => {
    const q = mockQuery({ data: [{ id: 'b1', enabled: false }], error: null })
    queue(q)
    const res = await request(app).patch('/api/chatbot/bots/b1').set(AUTH).send({ enabled: false })
    expect(res.status).toBe(200)
    expect(res.body.enabled).toBe(false)
    expect(q.eq).toHaveBeenCalledWith('hub_id', HUB_ID)
  })

  it('category 수정 허용', async () => {
    const q = mockQuery({ data: [{ id: 'b1', category: '결제' }], error: null })
    queue(q)
    const res = await request(app).patch('/api/chatbot/bots/b1').set(AUTH).send({ category: '결제' })
    expect(res.status).toBe(200)
    expect(q.update).toHaveBeenCalledWith(expect.objectContaining({ category: '결제' }))
  })
})

describe('DELETE /api/chatbot/bots/:id', () => {
  it('삭제 성공 + hub_id 가드', async () => {
    const q = mockQuery({ data: null, error: null })
    queue(q)
    expect((await request(app).delete('/api/chatbot/bots/b1').set(AUTH)).status).toBe(200)
    expect(q.eq).toHaveBeenCalledWith('hub_id', HUB_ID)
  })
})

describe('POST /api/chatbot/run-check', () => {
  it('GITHUB_TOKEN 미설정이면 503 + 안내', async () => {
    delete process.env.GITHUB_TOKEN
    const res = await request(app).post('/api/chatbot/run-check').set(AUTH).send({})
    expect(res.status).toBe(503)
    expect(res.body.error).toContain('GITHUB_TOKEN')
  })

  it('전체 실행: hub만 담아 dispatch 후 202', async () => {
    process.env.GITHUB_TOKEN = 'ghp_test'
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: true, status: 204 })
    const res = await request(app).post('/api/chatbot/run-check').set(AUTH).send({})
    expect(res.status).toBe(202)
    const [url, opts] = fetchSpy.mock.calls[0]
    expect(url).toContain('/actions/workflows/chatbot-check.yml/dispatches')
    expect(JSON.parse(opts.body)).toEqual({ ref: 'main', inputs: { hub: 'delivery' } })
    fetchSpy.mockRestore()
  })

  it('개별 실행: bot_id를 inputs로 전달', async () => {
    process.env.GITHUB_TOKEN = 'ghp_test'
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: true, status: 204 })
    const res = await request(app).post('/api/chatbot/run-check').set(AUTH).send({ bot_id: 'b1' })
    expect(res.status).toBe(202)
    const [, opts] = fetchSpy.mock.calls[0]
    expect(JSON.parse(opts.body)).toEqual({ ref: 'main', inputs: { hub: 'delivery', bot_id: 'b1' } })
    fetchSpy.mockRestore()
  })

  it('카테고리 실행: category를 inputs로 전달', async () => {
    process.env.GITHUB_TOKEN = 'ghp_test'
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: true, status: 204 })
    const res = await request(app).post('/api/chatbot/run-check').set(AUTH).send({ category: '예약' })
    expect(res.status).toBe(202)
    const [, opts] = fetchSpy.mock.calls[0]
    expect(JSON.parse(opts.body)).toEqual({ ref: 'main', inputs: { hub: 'delivery', category: '예약' } })
    fetchSpy.mockRestore()
  })

  it('bot_id가 category보다 우선', async () => {
    process.env.GITHUB_TOKEN = 'ghp_test'
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: true, status: 204 })
    await request(app).post('/api/chatbot/run-check').set(AUTH).send({ bot_id: 'b1', category: '예약' })
    const [, opts] = fetchSpy.mock.calls[0]
    expect(JSON.parse(opts.body)).toEqual({ ref: 'main', inputs: { hub: 'delivery', bot_id: 'b1' } })
    fetchSpy.mockRestore()
  })

  it('GitHub API 실패 시 502', async () => {
    process.env.GITHUB_TOKEN = 'ghp_test'
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'Bad credentials' })
    const res = await request(app).post('/api/chatbot/run-check').set(AUTH).send({})
    expect(res.status).toBe(502)
    fetchSpy.mockRestore()
  })
})

describe('GET /api/chatbot/dispatch (pg_cron 정시 트리거)', () => {
  const CRON = { authorization: 'Bearer cron-secret' }

  beforeEach(() => {
    process.env.CRON_SECRET = 'cron-secret'
    process.env.GITHUB_TOKEN = 'ghp_test'
  })

  it('CRON_SECRET 불일치면 401', async () => {
    const res = await request(app).get('/api/chatbot/dispatch').set({ authorization: 'Bearer wrong' })
    expect(res.status).toBe(401)
  })

  it('CRON_SECRET 미설정이면 401 (헤더만으로 통과 불가)', async () => {
    delete process.env.CRON_SECRET
    const res = await request(app).get('/api/chatbot/dispatch').set(CRON)
    expect(res.status).toBe(401)
  })

  it('GITHUB_TOKEN 미설정이면 503', async () => {
    delete process.env.GITHUB_TOKEN
    const res = await request(app).get('/api/chatbot/dispatch').set(CRON)
    expect(res.status).toBe(503)
  })

  it('허브 전체 봇 체크 디스패치: hub만 담아 202', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: true, status: 204 })
    const res = await request(app).get('/api/chatbot/dispatch').set(CRON)
    expect(res.status).toBe(202)
    const [url, opts] = fetchSpy.mock.calls[0]
    expect(url).toContain('/actions/workflows/chatbot-check.yml/dispatches')
    expect(JSON.parse(opts.body)).toEqual({ ref: 'main', inputs: { hub: 'delivery' } })
    fetchSpy.mockRestore()
  })

  it('GitHub API 실패 시 502', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'Bad credentials' })
    const res = await request(app).get('/api/chatbot/dispatch').set(CRON)
    expect(res.status).toBe(502)
    fetchSpy.mockRestore()
  })
})

describe('PATCH /api/chatbot/categories (이름 변경)', () => {
  it('from/to 누락이면 400', async () => {
    expect((await request(app).patch('/api/chatbot/categories').set(AUTH).send({ from: '예약' })).status).toBe(400)
    expect((await request(app).patch('/api/chatbot/categories').set(AUTH).send({ to: '  ' })).status).toBe(400)
  })

  it('봇 일괄 변경 + 관리 목록 이름 변경 (hub_id 스코프)', async () => {
    const botsQ = mockQuery({ error: null })
    const getQ = mockQuery({ data: { categories: ['예약', '결제'] }, error: null })
    const updQ = mockQuery({ data: { hub_id: HUB_ID, categories: ['상담', '결제'] }, error: null })
    queue(botsQ, getQ, updQ)
    const res = await request(app).patch('/api/chatbot/categories').set(AUTH).send({ from: '예약', to: ' 상담 ' })
    expect(res.status).toBe(200)
    expect(botsQ.update).toHaveBeenCalledWith({ category: '상담' })
    expect(botsQ.eq).toHaveBeenCalledWith('hub_id', HUB_ID)
    expect(botsQ.eq).toHaveBeenCalledWith('category', '예약')
    expect(updQ.update).toHaveBeenCalledWith(expect.objectContaining({ categories: ['상담', '결제'] }))
  })
})

describe('DELETE /api/chatbot/categories (삭제)', () => {
  it('name 누락이면 400', async () => {
    expect((await request(app).delete('/api/chatbot/categories').set(AUTH).send({})).status).toBe(400)
  })

  it('해당 봇은 미분류(null) + 관리 목록에서 제거', async () => {
    const botsQ = mockQuery({ error: null })
    const getQ = mockQuery({ data: { categories: ['예약', '결제'] }, error: null })
    const updQ = mockQuery({ data: { hub_id: HUB_ID, categories: ['결제'] }, error: null })
    queue(botsQ, getQ, updQ)
    const res = await request(app).delete('/api/chatbot/categories').set(AUTH).send({ name: '예약' })
    expect(res.status).toBe(200)
    expect(botsQ.update).toHaveBeenCalledWith({ category: null })
    expect(botsQ.eq).toHaveBeenCalledWith('category', '예약')
    expect(updQ.update).toHaveBeenCalledWith(expect.objectContaining({ categories: ['결제'] }))
  })
})

describe('settings', () => {
  it('GET: 허브 settings 행 반환', async () => {
    queue(mockQuery({ data: { hub_id: HUB_ID, recipients: ['a@b.c'] }, error: null }))
    const res = await request(app).get('/api/chatbot/settings').set(AUTH)
    expect(res.status).toBe(200)
    expect(res.body.recipients).toEqual(['a@b.c'])
  })

  it('PUT: recipients 갱신 + hub_id 스코프', async () => {
    const q = mockQuery({ data: { hub_id: HUB_ID, recipients: ['x@y.z'] }, error: null })
    queue(q)
    const res = await request(app).put('/api/chatbot/settings').set(AUTH).send({ recipients: ['x@y.z'] })
    expect(res.status).toBe(200)
    expect(res.body.recipients).toEqual(['x@y.z'])
    expect(q.eq).toHaveBeenCalledWith('hub_id', HUB_ID)
  })

  it('PUT: recipients만 보내면 categories는 건드리지 않음', async () => {
    const q = mockQuery({ data: { hub_id: HUB_ID }, error: null })
    queue(q)
    await request(app).put('/api/chatbot/settings').set(AUTH).send({ recipients: ['x@y.z'] })
    const patch = q.update.mock.calls[0][0]
    expect(patch).toHaveProperty('recipients')
    expect(patch).not.toHaveProperty('categories')
  })

  it('PUT: categories 갱신 (트림·중복·빈값 제거, 순서 유지)', async () => {
    const q = mockQuery({ data: { hub_id: HUB_ID, categories: ['예약', '결제'] }, error: null })
    queue(q)
    const res = await request(app).put('/api/chatbot/settings').set(AUTH)
      .send({ categories: [' 예약 ', '예약', '', '결제'] })
    expect(res.status).toBe(200)
    expect(q.update).toHaveBeenCalledWith(expect.objectContaining({ categories: ['예약', '결제'] }))
  })
})
