// server/routes/hubs.test.js — 허브 진입 라우터 계약.
// 허브별 비밀번호 판정 자체는 server/lib/hubAuth.test.js가 다룬다. 여기서는
// 이 라우터가 그 미들웨어를 제대로 걸고 있는지와 응답 모양을 고정한다.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

const mockFrom = vi.hoisted(() => vi.fn())
vi.mock('../db.js', () => ({ default: { from: mockFrom } }))

function mockQuery(result) {
  const p = Promise.resolve(result)
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
    then: (resolve, reject) => p.then(resolve, reject),
  }
}

const { default: hubsRouter } = await import('./hubs.js')
const { hashPassword } = await import('../lib/hubPassword.js')
const app = express()
app.use(express.json())
app.use('/api/hubs', hubsRouter)

const CS_HASH = hashPassword('cs-pw')

// hubAuth와 라우터가 각각 hubs를 조회하므로 테이블별로 응답을 세운다.
function setup({ hub, features = [] } = {}) {
  mockFrom.mockImplementation((table) => {
    if (table === 'hubs') return mockQuery({ data: hub, error: null })
    return mockQuery({ data: features, error: null })
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.APP_PASSWORD = 'master-pw'
  delete process.env.CRON_SECRET
})

describe('GET /api/hubs/:hubKey — 잠금 화면용 최소 정보(항상 공개)', () => {
  it('비밀번호가 걸린 허브도 이름과 requiresPassword는 알려준다', async () => {
    setup({ hub: { key: 'cs', name: 'CS', enabled: true, password_hash: CS_HASH } })
    const res = await request(app).get('/api/hubs/cs')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ key: 'cs', name: 'CS', requiresPassword: true })
  })

  it('해시는 내보내지 않는다', async () => {
    setup({ hub: { key: 'cs', name: 'CS', enabled: true, password_hash: CS_HASH } })
    const res = await request(app).get('/api/hubs/cs')
    expect(JSON.stringify(res.body)).not.toContain('scrypt$')
  })

  it('비밀번호 없는 허브는 requiresPassword=false', async () => {
    setup({ hub: { key: 'ops', name: 'Ops', enabled: true, password_hash: null } })
    const res = await request(app).get('/api/hubs/ops')
    expect(res.body.requiresPassword).toBe(false)
  })

  it('없는 허브는 404', async () => {
    setup({ hub: null })
    expect((await request(app).get('/api/hubs/nope')).status).toBe(404)
  })

  it('비활성 허브는 404', async () => {
    setup({ hub: { key: 'cs', name: 'CS', enabled: false, password_hash: null } })
    expect((await request(app).get('/api/hubs/cs')).status).toBe(404)
  })
})

describe('GET /api/hubs/:hubKey/features — 비밀번호 없는 허브', () => {
  beforeEach(() => {
    setup({
      hub: { id: 'h1', key: 'ops', name: 'Ops', enabled: true, password_hash: null },
      features: [
        { feature_key: 'module-b', enabled: true, sort_order: 0, config: { recipients: ['a@b.c'] } },
        { feature_key: 'module-c', enabled: false, sort_order: 1 },
      ],
    })
  })

  it('비밀번호 없이 200', async () => {
    const res = await request(app).get('/api/hubs/ops/features')
    expect(res.status).toBe(200)
    expect(res.body.hub).toEqual({ key: 'ops', name: 'Ops' })
  })

  it('꺼진 모듈은 제외한다', async () => {
    const res = await request(app).get('/api/hubs/ops/features')
    expect(res.body.features.map(f => f.feature_key)).toEqual(['module-b'])
  })

  it('config는 내보내지 않는다 — 수신자·환경 설정이 담기는 필드다', async () => {
    const res = await request(app).get('/api/hubs/ops/features')
    expect(JSON.stringify(res.body)).not.toContain('a@b.c')
    expect(res.body.features[0]).not.toHaveProperty('config')
  })
})

describe('GET /api/hubs/:hubKey/features — 비밀번호가 걸린 허브', () => {
  beforeEach(() => {
    setup({
      hub: { id: 'h1', key: 'cs', name: 'CS', enabled: true, password_hash: CS_HASH },
      features: [{ feature_key: 'module-b', enabled: true, sort_order: 0 }],
    })
  })

  it('비밀번호 없으면 401 + 잠금 화면에 띄울 허브 이름', async () => {
    const res = await request(app).get('/api/hubs/cs/features')
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('HUB_PASSWORD_REQUIRED')
    expect(res.body.hub).toEqual({ key: 'cs', name: 'CS' })
  })

  it('맞는 허브 비밀번호면 200', async () => {
    const res = await request(app).get('/api/hubs/cs/features').set('x-hub-password', 'cs-pw')
    expect(res.status).toBe(200)
    expect(res.body.features.map(f => f.feature_key)).toEqual(['module-b'])
  })

  it('틀린 허브 비밀번호면 401', async () => {
    expect((await request(app).get('/api/hubs/cs/features').set('x-hub-password', 'nope')).status).toBe(401)
  })

  it('APP_PASSWORD 마스터키로도 열린다', async () => {
    const res = await request(app).get('/api/hubs/cs/features').set('x-app-password', 'master-pw')
    expect(res.status).toBe(200)
  })
})
