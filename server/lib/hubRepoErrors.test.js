// 저장소 계층 도입(2026-11-09) 뒤에도 허브 조회가 DB 오류를 내면 이전처럼 '없는 허브'(404)로 답한다.
// 이전 코드는 supabase-js의 { data } 만 보고 error를 무시했다 — 저장소가 throw하게 되면서 500으로 바뀌지 않게 고정한다.
import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('../data/index.js', () => ({
  repos: {
    hubs: { getHubByKey: vi.fn().mockRejectedValue(new Error('connection reset')) },
    features: { getFeature: vi.fn().mockRejectedValue(new Error('connection reset')) },
  },
}))

const { requireHubAccess } = await import('./hubAuth.js')
const { requireHubFeature } = await import('./hubFeature.js')

function app(mw) {
  const a = express()
  a.get('/t', mw, (_req, res) => res.json({ ok: true }))
  return a
}

describe('허브 조회 DB 오류', () => {
  it('requireHubAccess는 404', async () => {
    expect((await request(app(requireHubAccess())).get('/t?hub=ops')).status).toBe(404)
  })
  it('requireHubFeature는 404', async () => {
    expect((await request(app(requireHubFeature('module-b'))).get('/t?hub=ops')).status).toBe(404)
  })
})
