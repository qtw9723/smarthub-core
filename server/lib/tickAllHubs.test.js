// ?hub=* tick — 크론 비밀이 있어야 하고, 모든 허브 순회 결과를 { hubs } 로 돌려준다(메일러·Grafana).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

const forEachHub = vi.hoisted(() => vi.fn(async (key) => [{ hub: 'ops', ok: true, result: { key } }]))
vi.mock('./forEachHub.js', () => ({ forEachHub, isAllHubs: (req) => req.query.hub === '*' }))
vi.mock('../data/index.js', () => ({ repos: { hubs: { getHubId: vi.fn(async () => null), getHubByKey: vi.fn(async () => null) } } }))

beforeEach(() => { process.env.CRON_SECRET = 'cron-secret'; forEachHub.mockClear() })

describe.each([
  ['mailer', '../modules/mailer/router.js'],
  ['grafana-reports', '../modules/grafana-reports/router.js'],
])('%s /tick?hub=*', (feature, path) => {
  async function app() {
    const { default: router } = await import(path)
    const a = express()
    a.use('/m', router)
    return a
  }
  // 크론 비밀이 없으면 허브 관문(requireHubAccess)이 먼저 '*'를 없는 허브로 보고 404 — 어느 쪽이든 순회는 없다.
  it('크론 비밀이 없으면 막히고(404) 순회하지 않는다', async () => {
    expect((await request(await app()).get('/m/tick?hub=*')).status).toBe(404)
    expect(forEachHub).not.toHaveBeenCalled()
  })
  it('크론 비밀이 맞으면 기능 키로 모든 허브를 돌고 { hubs }', async () => {
    const res = await request(await app()).get('/m/tick?hub=*').set('Authorization', 'Bearer cron-secret')
    expect(res.status).toBe(200)
    expect(forEachHub).toHaveBeenCalledWith(feature, expect.any(Function))
    expect(res.body).toEqual({ hubs: [{ hub: 'ops', ok: true, result: { key: feature } }] })
  })
})
