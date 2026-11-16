// PUT /api/admin/master-key — 지금 마스터 키로 들어온 사람만 바꾼다(키 저장은 server/lib/masterKey.js).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('../db.js', () => ({ default: { from: vi.fn() } }))
const { setMasterKey } = await import('../lib/masterKey.js')
const { default: adminRouter } = await import('./admin.js')
const app = express()
app.use(express.json())
app.use('/api/admin', adminRouter)

beforeEach(() => { process.env.APP_PASSWORD = 'current-key'; vi.mocked(setMasterKey).mockClear() })

describe('PUT /api/admin/master-key', () => {
  it('지금 키가 없으면 401, 바꾸지 않는다', async () => {
    expect((await request(app).put('/api/admin/master-key').send({ next: 'brand-new-key' })).status).toBe(401)
    expect(setMasterKey).not.toHaveBeenCalled()
  })
  it('8자 미만이면 400', async () => {
    const res = await request(app).put('/api/admin/master-key').set('x-app-password', 'current-key').send({ next: 'short' })
    expect(res.status).toBe(400)
    expect(setMasterKey).not.toHaveBeenCalled()
  })
  it('지금 키와 같으면 400', async () => {
    const res = await request(app).put('/api/admin/master-key').set('x-app-password', 'current-key').send({ next: 'current-key' })
    expect(res.status).toBe(400)
  })
  it('바꾼다', async () => {
    const res = await request(app).put('/api/admin/master-key').set('x-app-password', 'current-key').send({ next: 'brand-new-key' })
    expect(res.status).toBe(200)
    expect(setMasterKey).toHaveBeenCalledWith('brand-new-key')
  })
})
