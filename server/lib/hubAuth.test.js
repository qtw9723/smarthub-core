// server/lib/hubAuth.test.js — 허브 스코프 인증 계약.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

const mockFrom = vi.hoisted(() => vi.fn())
vi.mock('../db.js', () => ({ default: { from: mockFrom } }))

function hubRow(row) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: row, error: null }),
  }
}

const { requireHubAccess } = await import('./hubAuth.js')
const { hashPassword } = await import('./hubPassword.js')

const CS_HASH = hashPassword('cs-pw')
const DELIVERY_HASH = hashPassword('delivery-pw')

// ?hub= 없으면 delivery를 대상으로 삼는 라우터를 흉내낸다.
const app = express()
app.use(express.json())
app.use(requireHubAccess('delivery'))
app.get('/thing', (_req, res) => res.json({ ok: true }))
app.post('/thing', (_req, res) => res.json({ ok: true }))

beforeEach(() => {
  vi.clearAllMocks()
  process.env.APP_PASSWORD = 'master-pw'
  process.env.CRON_SECRET = 'cron-secret'
})

describe('비밀번호가 걸린 허브', () => {
  beforeEach(() => { mockFrom.mockReturnValue(hubRow({ key: 'cs', name: 'CS', password_hash: CS_HASH })) })

  it('비밀번호 없이는 401 + 허브 이름(잠금 화면용)', async () => {
    const res = await request(app).get('/thing?hub=cs')
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('HUB_PASSWORD_REQUIRED')
    expect(res.body.hub).toEqual({ key: 'cs', name: 'CS' })
  })

  it('해시는 401 응답에 절대 실리지 않는다', async () => {
    const res = await request(app).get('/thing?hub=cs')
    expect(JSON.stringify(res.body)).not.toContain('scrypt$')
  })

  it('맞는 허브 비밀번호면 통과', async () => {
    const res = await request(app).get('/thing?hub=cs').set('x-hub-password', 'cs-pw')
    expect(res.status).toBe(200)
  })

  it('틀린 허브 비밀번호면 401', async () => {
    expect((await request(app).get('/thing?hub=cs').set('x-hub-password', 'nope')).status).toBe(401)
  })

  it('다른 허브의 비밀번호로는 열 수 없다 — delivery 비밀번호로 cs 진입 불가', async () => {
    expect((await request(app).get('/thing?hub=cs').set('x-hub-password', 'delivery-pw')).status).toBe(401)
  })

  it('APP_PASSWORD는 마스터키 — 허브 비밀번호 없이 통과', async () => {
    const res = await request(app).get('/thing?hub=cs').set('x-app-password', 'master-pw')
    expect(res.status).toBe(200)
  })

  it('틀린 APP_PASSWORD는 마스터키가 아니다', async () => {
    expect((await request(app).get('/thing?hub=cs').set('x-app-password', 'wrong')).status).toBe(401)
  })

  it('APP_PASSWORD 미설정이면 빈 헤더로 마스터 통과할 수 없다', async () => {
    delete process.env.APP_PASSWORD
    expect((await request(app).get('/thing?hub=cs')).status).toBe(401)
  })

  it('유효한 CRON_SECRET Bearer는 지나간다 — 자동 트리거용', async () => {
    const res = await request(app).get('/thing?hub=cs').set('Authorization', 'Bearer cron-secret')
    expect(res.status).toBe(200)
  })

  it('아무 Bearer나 통과시키지 않는다 — 헤더 하나로 우회 금지', async () => {
    expect((await request(app).get('/thing?hub=cs').set('Authorization', 'Bearer wrong')).status).toBe(401)
  })

  it('CRON_SECRET 미설정이면 Bearer로 우회 불가', async () => {
    delete process.env.CRON_SECRET
    const res = await request(app).get('/thing?hub=cs').set('Authorization', 'Bearer undefined')
    expect(res.status).toBe(401)
  })

  it('body.hub로도 허브를 잡는다', async () => {
    const res = await request(app).post('/thing').send({ hub: 'cs' })
    expect(res.status).toBe(401)
    expect(mockFrom).toHaveBeenCalledWith('hubs')
  })
})

describe('한글 비밀번호 (헤더는 latin-1)', () => {
  const KO_HASH = hashPassword('한글비밀번호')
  beforeEach(() => { mockFrom.mockReturnValue(hubRow({ key: 'cs', name: 'CS', password_hash: KO_HASH })) })

  it('퍼센트 인코딩된 값을 되돌려 검증한다 — 클라이언트가 이렇게 보낸다', async () => {
    const res = await request(app).get('/thing?hub=cs')
      .set('x-hub-password', encodeURIComponent('한글비밀번호'))
    expect(res.status).toBe(200)
  })

  it('틀린 한글 비밀번호는 여전히 401', async () => {
    const res = await request(app).get('/thing?hub=cs')
      .set('x-hub-password', encodeURIComponent('다른비밀번호'))
    expect(res.status).toBe(401)
  })

  it('인코딩하지 않은 ASCII 비밀번호도 그대로 통과한다 — curl 직접 호출', async () => {
    mockFrom.mockReturnValue(hubRow({ key: 'cs', name: 'CS', password_hash: CS_HASH }))
    expect((await request(app).get('/thing?hub=cs').set('x-hub-password', 'cs-pw')).status).toBe(200)
  })

  it('깨진 퍼센트 시퀀스는 던지지 않고 401', async () => {
    expect((await request(app).get('/thing?hub=cs').set('x-hub-password', '%E0%A4%A')).status).toBe(401)
  })
})

describe('비밀번호가 없는 허브', () => {
  it('그냥 통과 — 미설정 허브는 공개다', async () => {
    mockFrom.mockReturnValue(hubRow({ key: 'ops', name: 'Ops', password_hash: null }))
    expect((await request(app).get('/thing?hub=ops')).status).toBe(200)
  })
})

describe('없는 허브', () => {
  it('404 — 통과시키면 ?hub=아무거나로 인증을 우회할 수 있다', async () => {
    mockFrom.mockReturnValue(hubRow(null))
    expect((await request(app).get('/thing?hub=nope')).status).toBe(404)
  })
})

describe('기본 허브가 없는 라우터', () => {
  const noDefault = express()
  noDefault.use(express.json())
  noDefault.use(requireHubAccess())
  noDefault.post('/parse', (_req, res) => res.json({ ok: true }))

  it('hub를 안 주면 400 — hub를 빼는 것만으로 인증을 건너뛸 수 없다', async () => {
    const res = await request(noDefault).post('/parse').send({ text: 'hi' })
    expect(res.status).toBe(400)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('hub를 주면 그 허브의 비밀번호를 요구한다', async () => {
    mockFrom.mockReturnValue(hubRow({ key: 'cs', name: 'CS', password_hash: CS_HASH }))
    expect((await request(noDefault).post('/parse?hub=cs').send({ text: 'hi' })).status).toBe(401)
  })
})

describe('기본 허브', () => {
  it('?hub=가 없으면 라우터의 기본 허브를 대상으로 본다', async () => {
    const q = hubRow({ key: 'delivery', name: 'Delivery', password_hash: DELIVERY_HASH })
    mockFrom.mockReturnValue(q)
    expect((await request(app).get('/thing')).status).toBe(401)
    expect(q.eq).toHaveBeenCalledWith('key', 'delivery')
  })
})
