// server/lib/asyncRoute.test.js
// Express 4는 async 핸들러의 거부를 잡지 않는다. 핸들러가 던지면 응답이 만들어지지 않아
// 요청이 매달리고, 서버리스에서는 함수가 maxDuration을 다 쓰고 504로 죽는다 —
// 잘못된 파라미터 하나가 호출 한 번을 통째로 태운다. 실제로 프로덕션에서 재현됐다.
import { describe, it, expect } from 'vitest'
import express, { Router } from 'express'
import request from 'supertest'
import { catchAsync, guardAsyncRouter, finalizeAsyncRouter } from './asyncRoute.js'

function appWith(router) {
  const app = express()
  app.use(express.json())
  app.use('/t', router)
  return app
}

describe('catchAsync', () => {
  it('거부하는 핸들러도 응답을 만든다 — 매달리지 않는다', async () => {
    const r = Router()
    r.get('/boom', catchAsync(async () => { throw new Error('db exploded') }))
    r.use((err, _req, res, next) => (err ? res.status(500).json({ error: 'x' }) : next()))
    const res = await request(appWith(r)).get('/t/boom')
    expect(res.status).toBe(500)
  })
})

describe('guardAsyncRouter', () => {
  it('이후 정의되는 모든 라우트를 자동으로 감싼다', async () => {
    const r = guardAsyncRouter(Router())
    r.get('/a', async () => { throw new Error('boom a') })
    r.post('/b', async () => { throw new Error('boom b') })
    r.patch('/c', async () => { throw new Error('boom c') })
    r.delete('/d', async () => { throw new Error('boom d') })
    r.put('/e', async () => { throw new Error('boom e') })
    finalizeAsyncRouter(r)
    const app = appWith(r)
    for (const [m, p] of [['get','/t/a'],['post','/t/b'],['patch','/t/c'],['delete','/t/d'],['put','/t/e']]) {
      const res = await request(app)[m](p)
      expect(res.status, `${m} ${p}`).toBe(500)
    }
  })

  it('500 본문에 내부 오류 원문을 담지 않는다', async () => {
    const r = guardAsyncRouter(Router())
    r.get('/leak', async () => { throw new Error('invalid input syntax for type uuid: "x"') })
    finalizeAsyncRouter(r)
    const res = await request(appWith(r)).get('/t/leak')
    // 본문 원문으로 본다 — HTML 오류 페이지면 res.body가 비어 단언이 공회전한다.
    expect(res.text).not.toMatch(/uuid|syntax/i)
    expect(res.body.error).toBe('처리 중 오류가 발생했습니다')
  })

  it('정상 응답은 그대로 통과한다', async () => {
    const r = guardAsyncRouter(Router())
    r.get('/ok', async (_req, res) => res.json({ ok: true }))
    const res = await request(appWith(r)).get('/t/ok')
    expect(res.body).toEqual({ ok: true })
  })

  it('동기 핸들러도 감싼다', async () => {
    const r = guardAsyncRouter(Router())
    r.get('/sync', () => { throw new Error('sync boom') })
    finalizeAsyncRouter(r)
    const res = await request(appWith(r)).get('/t/sync')
    expect(res.status).toBe(500)
  })

  it('미들웨어를 함께 단 라우트도 감싼다', async () => {
    const r = guardAsyncRouter(Router())
    const mw = (req, _res, next) => { req.tag = 'mw'; next() }
    r.get('/mw', mw, async (req) => { throw new Error(`boom ${req.tag}`) })
    finalizeAsyncRouter(r)
    const res = await request(appWith(r)).get('/t/mw')
    expect(res.status).toBe(500)
  })
})
