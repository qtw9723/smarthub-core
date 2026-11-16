// server/lib/hubFeature.test.js — "이 허브에서 이 모듈이 켜져 있는가" 계약.
//
// 인증(hubAuth)과 분리된 검사다. 인증은 "당신이 이 허브에 들어와도 되는가"를 묻고,
// 이것은 "그 허브가 이 기능을 쓰기로 했는가"를 묻는다. 외부 비용이 걸린 경로(예: LLM 호출)에서
// 후자가 빠져 있으면, 기능을 켠 적 없는 허브 이름만 붙여도 청구가 발생한다.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

const mockFrom = vi.hoisted(() => vi.fn())
vi.mock('../db.js', () => ({ default: { from: mockFrom } }))

const { requireHubFeature } = await import('./hubFeature.js')

// 테이블별로 다른 응답을 돌려주는 체이너블 mock.
function db({ hub, feature }) {
  mockFrom.mockImplementation(table => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: table === 'hubs' ? hub : feature, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: table === 'hubs' ? hub : feature, error: null }),
  }))
}

const CS = { id: 'hub-cs-uuid', key: 'cs', enabled: true }

const app = express()
app.use(express.json())
app.use(requireHubFeature('module-a'))
app.get('/thing', (_req, res) => res.json({ ok: true }))
app.post('/thing', (_req, res) => res.json({ ok: true }))

beforeEach(() => {
  vi.clearAllMocks()
  process.env.APP_PASSWORD = 'master-pw'
})

describe('기능이 켜진 허브', () => {
  it('통과한다', async () => {
    db({ hub: CS, feature: { enabled: true } })
    expect((await request(app).get('/thing?hub=cs')).status).toBe(200)
  })

  it('?hub= 대신 body.hub로도 대상 허브를 정한다', async () => {
    db({ hub: CS, feature: { enabled: true } })
    expect((await request(app).post('/thing').send({ hub: 'cs' })).status).toBe(200)
  })
})

describe('기능이 켜지지 않은 허브', () => {
  it('hub_features 행이 enabled:false면 404', async () => {
    db({ hub: CS, feature: { enabled: false } })
    const res = await request(app).get('/thing?hub=cs')
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('feature not enabled')
  })

  it('hub_features 행 자체가 없으면 404', async () => {
    db({ hub: CS, feature: null })
    expect((await request(app).get('/thing?hub=cs')).status).toBe(404)
  })

  // 마스터키는 "인증 우회"지 "켠 적 없는 기능 사용"이 아니다. 이게 뚫리면 헤더 하나로
  // 아무 허브 이름이나 붙여 외부 청구를 만들 수 있다.
  it('APP_PASSWORD 마스터키로도 뚫리지 않는다', async () => {
    db({ hub: CS, feature: { enabled: false } })
    const res = await request(app).get('/thing?hub=cs').set('x-app-password', 'master-pw')
    expect(res.status).toBe(404)
  })
})

describe('대상 허브가 성립하지 않을 때', () => {
  it('hub 파라미터가 없으면 400', async () => {
    db({ hub: CS, feature: { enabled: true } })
    const res = await request(app).get('/thing')
    expect(res.status).toBe(400)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('없는 허브면 404', async () => {
    db({ hub: null, feature: { enabled: true } })
    expect((await request(app).get('/thing?hub=nope')).status).toBe(404)
  })

  it('비활성 허브면 404', async () => {
    db({ hub: { ...CS, enabled: false }, feature: { enabled: true } })
    expect((await request(app).get('/thing?hub=cs')).status).toBe(404)
  })
})
