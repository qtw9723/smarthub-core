// 팀 주소 — <허브키>.<TEAM_HOST_SUFFIX>로 들어오면 그 팀 허브만 쓰게 한다(2026-11-10 사용자 결정: 팀원에게 백오피스를 막는다).
import { describe, it, expect } from 'vitest'
import request from 'supertest'
import express from 'express'
import { teamHubOf, teamHostGuard } from './teamHost.js'

const SUFFIX = 'smarthub.example.com'

describe('teamHubOf', () => {
  it('<허브키>.<접미사> → 허브 키', () => {
    expect(teamHubOf('cs.smarthub.example.com', SUFFIX)).toBe('cs')
    expect(teamHubOf('delivery.smarthub.example.com', SUFFIX)).toBe('delivery')
  })
  it('대소문자·포트를 무시한다', () => {
    expect(teamHubOf('CS.SmartHub.example.com:80', SUFFIX)).toBe('cs')
  })
  it('접미사 그 자체(관리자 주소)는 팀 주소가 아니다', () => {
    expect(teamHubOf('smarthub.example.com', SUFFIX)).toBeNull()
  })
  it('다른 도메인·접미사를 흉내 낸 이름은 아니다', () => {
    expect(teamHubOf('other.example.com', SUFFIX)).toBeNull()
    expect(teamHubOf('evilsmarthub.example.com', SUFFIX)).toBeNull()
    expect(teamHubOf('a.b.smarthub.example.com', SUFFIX)).toBeNull()
  })
  it('접미사가 없으면(외부 에디션) 언제나 null', () => {
    expect(teamHubOf('cs.smarthub.example.com', '')).toBeNull()
    expect(teamHubOf('cs.smarthub.example.com', undefined)).toBeNull()
  })
})

function appWith() {
  const app = express()
  app.use(express.json())
  app.use(teamHostGuard(SUFFIX))
  app.all(/^\/api\/.*/, (req, res) => res.json({ path: req.path, hub: req.query.hub ?? null }))
  app.get(/.*/, (req, res) => res.json({ page: req.path, teamHub: req.teamHub ?? null }))
  return app
}
const at = (host) => ({
  get: (p) => request(appWith()).get(p).set('Host', host),
  post: (p, body) => request(appWith()).post(p).set('Host', host).send(body),
})
const cs = at('cs.smarthub.example.com')

describe('teamHostGuard — 팀 주소', () => {
  it('관리자 API는 없는 것처럼 404', async () => {
    expect((await cs.get('/api/admin/hubs')).status).toBe(404)
    expect((await cs.get('/api/admin')).status).toBe(404)
  })
  it('다른 허브 조회는 404, 자기 허브는 통과', async () => {
    expect((await cs.get('/api/hubs/delivery')).status).toBe(404)
    expect((await cs.get('/api/hubs/cs')).status).toBe(200)
  })
  it('다른 허브를 ?hub=·본문 hub로 지정하면 404 (전체 허브 * 포함)', async () => {
    expect((await cs.get('/api/modules/module-b/jobs?hub=delivery')).status).toBe(404)
    expect((await cs.get('/api/modules/module-b/tick?hub=*')).status).toBe(404)
    expect((await cs.post('/api/modules/x', { hub: 'delivery' })).status).toBe(404)
  })
  it('허브를 안 적으면 팀 허브로 고정한다 — 모듈 기본 허브로 새지 않게', async () => {
    expect((await at('delivery.smarthub.example.com').get('/api/modules/module-b/jobs')).body.hub).toBe('delivery')
  })
  it('자기 허브 API는 그대로', async () => {
    const res = await cs.get('/api/modules/module-b/jobs?hub=cs')
    expect(res.status).toBe(200)
    expect(res.body.hub).toBe('cs')
  })
  // 2026-11-10 사내 QA I1 — Express 라우팅은 대소문자를 가리지 않는데 관문은 가려서 /API/…가 그냥 통과했다.
  it('경로 대소문자를 바꿔도 막는다', async () => {
    expect((await cs.get('/API/hubs/delivery')).status).toBe(404)
    expect((await cs.get('/api/Hubs/delivery')).status).toBe(404)
    expect((await cs.get('/Api/admin/hubs')).status).toBe(404)
    expect((await cs.get('/api/ADMIN/security')).status).toBe(404)
    expect((await cs.get('/API/chatbot/bots?hub=delivery')).status).toBe(404)
  })
  it('대문자 경로에서도 허브를 안 적으면 팀 허브로 고정한다', async () => {
    const app = express()
    app.use(teamHostGuard(SUFFIX))
    app.get('/api/modules/module-b/jobs', (req, res) => res.json({ hub: req.query.hub ?? null })) // Express 기본: 대소문자 무시
    const res = await request(app).get('/API/modules/module-b/jobs').set('Host', 'cs.smarthub.example.com')
    expect(res.body.hub).toBe('cs')
  })
  it('화면 요청에는 팀 허브를 표시한다', async () => {
    expect((await cs.get('/hub/cs')).body.teamHub).toBe('cs')
  })
})

describe('teamHostGuard — 관리자 주소·클러스터 내부 호출', () => {
  it('접미사 그대로의 주소는 아무것도 막지 않는다', async () => {
    const admin = at('smarthub.example.com')
    expect((await admin.get('/api/admin/hubs')).status).toBe(200)
    expect((await admin.get('/api/modules/module-b/tick?hub=*')).body.hub).toBe('*')
  })
  it('CronJob이 부르는 서비스 주소(smarthub:8080)도 그대로', async () => {
    expect((await at('smarthub:8080').get('/api/modules/module-b/tick?hub=*')).body.hub).toBe('*')
  })
})
