// /api/health — k8s 프로브용. 허브 관문·DB 없이 프로세스가 응답하는지만 본다(DB 장애로 파드가 재시작 반복하지 않게).
import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'

vi.stubEnv('VERCEL', '1') // listen 하지 않게
const { default: app } = await import('./index.js')

describe('GET /api/health', () => {
  it('200 { ok: true }', async () => {
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })
})
