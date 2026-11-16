// supertest 요청 주소가 서버가 붙은 IPv6와 맞는다 — 병렬 테스트 간 포트 혼선 방지(loopbackListen.js).
import { it, expect } from 'vitest'
import request from 'supertest'
import express from 'express'

it('IPv6로 붙은 테스트 서버에는 [::1]로 요청한다', async () => {
  const app = express()
  app.get('/', (req, res) => res.json({ remote: req.socket.remoteAddress }))
  const res = await request(app).get('/')
  expect(res.status).toBe(200)
  expect(res.body.remote).toMatch(/^(::1|::ffff:127\.0\.0\.1|127\.0\.0\.1)$/)
  if (res.body.remote !== '127.0.0.1') expect(res.body.remote).toBe('::1')
})
