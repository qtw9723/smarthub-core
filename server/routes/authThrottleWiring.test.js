// 로그인 시도 제한이 두 관문(백오피스 마스터 키·허브 비밀번호)에 걸려 있는가. 제한 자체는 lib/authThrottle.test.js.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

const mockFrom = vi.hoisted(() => vi.fn())
vi.mock('../db.js', () => ({ default: { from: mockFrom } }))
const { isBlocked, noteFailure } = await import('../lib/authThrottle.js')
const { default: adminRouter } = await import('./admin.js')
const { requireHubAccess } = await import('../lib/hubAuth.js')
const { hashPassword } = await import('../lib/hubPassword.js')

const admin = express().use(express.json()).use('/api/admin', adminRouter)
const hubApp = express().use(express.json()).use(requireHubAccess()).get('/thing', (_q, r) => r.json({ ok: true }))
const hubRow = (row) => ({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: row, error: null }) })
const blockNow = () => vi.mocked(isBlocked).mockResolvedValueOnce({ blocked: true, retryAfterSec: 900 })

beforeEach(() => {
  vi.mocked(isBlocked).mockClear(); vi.mocked(noteFailure).mockClear()
  process.env.APP_PASSWORD = 'master-pw'
})

describe('백오피스 마스터 키', () => {
  it('틀리면 401 + 실패 기록', async () => {
    expect((await request(admin).get('/api/admin/hubs').set('x-app-password', 'nope')).status).toBe(401)
    expect(noteFailure).toHaveBeenCalledTimes(1)
  })
  it('막혀 있으면 맞는 키여도 429(Retry-After) — 확인하지 않는다', async () => {
    blockNow()
    const res = await request(admin).get('/api/admin/hubs').set('x-app-password', 'master-pw')
    expect(res.status).toBe(429)
    expect(res.body.error).toBe('TOO_MANY_ATTEMPTS')
  })
  it('키 없이 부른 건 시도로 세지 않는다', async () => {
    expect((await request(admin).get('/api/admin/hubs')).status).toBe(401)
    expect(noteFailure).not.toHaveBeenCalled()
  })
})

describe('허브 비밀번호', () => {
  it('공개 허브는 시도 제한을 보지 않는다(DB 조회 없음)', async () => {
    mockFrom.mockReturnValue(hubRow({ key: 'cs', name: 'CS', password_hash: null }))
    expect((await request(hubApp).get('/thing?hub=cs')).status).toBe(200)
    expect(isBlocked).not.toHaveBeenCalled()
  })
  it('비밀번호가 틀리면 401 + 실패 기록', async () => {
    mockFrom.mockReturnValue(hubRow({ key: 'cs', name: 'CS', password_hash: hashPassword('cs-pw') }))
    expect((await request(hubApp).get('/thing?hub=cs').set('x-hub-password', 'wrong')).status).toBe(401)
    expect(noteFailure).toHaveBeenCalledTimes(1)
  })
  it('막혀 있으면 맞는 비밀번호·마스터 키여도 429', async () => {
    mockFrom.mockReturnValue(hubRow({ key: 'cs', name: 'CS', password_hash: hashPassword('cs-pw') }))
    blockNow()
    expect((await request(hubApp).get('/thing?hub=cs').set('x-hub-password', 'cs-pw')).status).toBe(429)
    blockNow()
    expect((await request(hubApp).get('/thing?hub=cs').set('x-app-password', 'master-pw')).status).toBe(429)
  })
  it('맞으면 통과, 기록 없음', async () => {
    mockFrom.mockReturnValue(hubRow({ key: 'cs', name: 'CS', password_hash: hashPassword('cs-pw') }))
    expect((await request(hubApp).get('/thing?hub=cs').set('x-hub-password', 'cs-pw')).status).toBe(200)
    expect(noteFailure).not.toHaveBeenCalled()
  })
})
