// 사내 에디션 정적 서빙 — Vercel이 하던 일(정적 파일·SPA 폴백)을 Express가 한다.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import express from 'express'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mountStatic } from './static.js'

let dir
let app
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'dist-'))
  mkdirSync(join(dir, 'docs'))
  writeFileSync(join(dir, 'index.html'), '<html><head></head>SPA</html>')
  writeFileSync(join(dir, 'docs', 'v2.html'), '<html>V2</html>')
  app = express()
  app.get('/api/hubs/x', (_req, res) => res.json({ ok: true }))
  mountStatic(app, dir)
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('mountStatic', () => {
  it('/ 와 앱 경로는 index.html(SPA)', async () => {
    expect((await request(app).get('/')).text).toContain('SPA')
    expect((await request(app).get('/hub/cs/chatbot-monitoring')).text).toContain('SPA')
  })
  it('정적 파일은 그대로', async () => {
    expect((await request(app).get('/docs/v2.html')).text).toContain('V2')
  })
  it('API는 SPA로 가지 않는다 — 없는 API는 404', async () => {
    expect((await request(app).get('/api/hubs/x')).body).toEqual({ ok: true })
    const res = await request(app).get('/api/nope')
    expect(res.status).toBe(404)
    expect(res.text).not.toContain('SPA')
  })

  it('팀 주소(req.teamHub)면 index.html에 팀 허브 표식을 심는다 — 화면이 백오피스·허브 목록 링크를 숨긴다', async () => {
    const team = express()
    team.use((req, _res, next) => { req.teamHub = 'cs'; next() })
    mountStatic(team, dir)
    for (const path of ['/', '/hub/cs', '/admin']) {
      const res = await request(team).get(path)
      expect(res.text).toContain('<meta name="smarthub-team-hub" content="cs">')
      expect(res.text).toContain('SPA')
    }
  })
  it('관리자 주소는 표식 없이 그대로', async () => {
    expect((await request(app).get('/')).text).not.toContain('smarthub-team-hub')
  })
})
