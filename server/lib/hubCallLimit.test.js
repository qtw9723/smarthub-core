// server/lib/hubCallLimit.test.js — 허브 단위 호출 상한 계약.
//
// 이 상한이 지키는 것은 서버 부하가 아니라 **외부 청구**다(외부 LLM 호출 등).
// 그래서 세는 것도 막는 것도 인스턴스가 아니라 DB 기준이다 — Vercel 서버리스에서
// 인메모리 카운터는 인스턴스마다 따로 놀고 콜드스타트마다 리셋돼 방어가 되지 않는다.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

const mockFrom = vi.hoisted(() => vi.fn())
vi.mock('../db.js', () => ({ default: { from: mockFrom } }))

const { limitHubCalls, CALLS_TABLE } = await import('./hubCallLimit.js')

let gteArg
let inserted

// count 조회(select head)와 insert를 한 체이너블 mock으로 흉내낸다.
function db({ count = 0, countError = null, insertError = null } = {}) {
  gteArg = undefined
  inserted = undefined
  mockFrom.mockImplementation(() => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn(function (_col, value) { gteArg = value; return Promise.resolve({ count, error: countError }) }),
    insert: vi.fn(row => { inserted = row; return Promise.resolve({ error: insertError }) }),
  }))
}

const HUB = { key: 'delivery', id: 'hub-delivery-uuid' }

const app = express()
app.use(express.json())
app.use((req, _res, next) => { req.hub = HUB; next() })
app.use(limitHubCalls('module-a', { limit: 3, windowMs: 60 * 60 * 1000 }))
app.post('/parse', (_req, res) => res.json({ ok: true }))

beforeEach(() => { vi.clearAllMocks() })

describe('상한 이내', () => {
  it('통과시킨다', async () => {
    db({ count: 2 })
    expect((await request(app).post('/parse')).status).toBe(200)
  })

  it('통과한 호출을 허브·기능과 함께 기록한다 — 다음 요청이 셀 수 있도록', async () => {
    db({ count: 0 })
    await request(app).post('/parse')
    expect(inserted).toMatchObject({ hub_id: HUB.id, feature_key: 'module-a' })
  })

  it('IP·요청 본문은 기록하지 않는다', async () => {
    db({ count: 0 })
    await request(app).post('/parse').send({ text: '비밀 문서 전문' })
    expect(JSON.stringify(inserted)).not.toContain('비밀 문서')
    expect(Object.keys(inserted)).toEqual(['hub_id', 'feature_key'])
  })

  it('윈도 시작 시각 이후만 센다', async () => {
    db({ count: 0 })
    const before = Date.now()
    await request(app).post('/parse')
    const windowStart = new Date(gteArg).getTime()
    expect(windowStart).toBeGreaterThanOrEqual(before - 60 * 60 * 1000 - 1000)
    expect(windowStart).toBeLessThanOrEqual(before - 60 * 60 * 1000 + 1000)
  })
})

describe('상한 도달', () => {
  beforeEach(() => { db({ count: 3 }) })

  it('429로 끊는다', async () => {
    const res = await request(app).post('/parse')
    expect(res.status).toBe(429)
    expect(res.body.limit).toBe(3)
  })

  it('막힌 요청은 기록하지 않는다 — 상한이 스스로 연장되지 않도록', async () => {
    await request(app).post('/parse')
    expect(inserted).toBeUndefined()
  })
})

// 비용 방어라서 DB가 대답을 못 하면 **닫는다**. 열어두면 "DB를 흔들면 상한이 사라지는"
// 우회로가 생긴다. 대신 사용자에겐 일시적 실패로 보이고 재시도로 회복된다.
describe('DB가 대답하지 못할 때', () => {
  it('세지 못하면 503 — 통과시키지 않는다', async () => {
    db({ countError: { message: 'boom' } })
    expect((await request(app).post('/parse')).status).toBe(503)
  })

  it('기록하지 못하면 503 — 세지 못하는 호출은 보내지 않는다', async () => {
    db({ count: 0, insertError: { message: 'boom' } })
    expect((await request(app).post('/parse')).status).toBe(503)
  })
})

it('기록 테이블 이름을 공개해 마이그레이션과 대조할 수 있게 한다', () => {
  expect(CALLS_TABLE).toBe('hub_module_calls')
})

// 상한을 모듈 로드 시점에 고정하면 운영 중 env 변경이 재배포 전까지 먹지 않고,
// 테스트에서도 값을 바꿀 수 없다. 요청마다 읽도록 함수 형태를 허용한다.
describe('상한을 함수로 주면', () => {
  it('요청마다 다시 읽는다', async () => {
    let max = 5
    const dyn = express()
    dyn.use(express.json())
    dyn.use((req, _res, next) => { req.hub = HUB; next() })
    dyn.use(limitHubCalls('module-a', { limit: () => max }))
    dyn.post('/parse', (_req, res) => res.json({ ok: true }))

    db({ count: 3 })
    expect((await request(dyn).post('/parse')).status).toBe(200)

    max = 3
    db({ count: 3 })
    expect((await request(dyn).post('/parse')).status).toBe(429)
  })
})

