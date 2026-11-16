// 사내 첨부 업로드(PUT /attachments/upload) — 서명된 경로만, 그 허브 것만, 10MB까지. 외부 에디션에는 없다(404).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HUB = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const SECRET = 'test-secret-0123456789abcdef0123456789'

vi.mock('../../data/index.js', () => ({ repos: { hubs: { getHubId: vi.fn(async (k) => (k === 'cs' ? HUB : null)), getHubByKey: vi.fn(async () => ({ key: 'cs', name: 'CS', password_hash: null })) } } }))

let root
async function appFor(editionName) {
  vi.resetModules()
  vi.stubEnv('SMARTHUB_EDITION', editionName)
  vi.stubEnv('ATTACHMENTS_DIR', root)
  vi.stubEnv('ATTACHMENT_SIGNING_SECRET', SECRET)
  const { default: router } = await import('./router.js')
  const app = express()
  app.use('/m', router)
  return app
}
const tokenFor = async (path, exp = Date.now() + 60_000) => (await import('../../editions/internal/uploadToken.js')).signToken(path, exp, SECRET)

beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'up-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }); vi.unstubAllEnvs() })

describe('PUT /attachments/upload (사내)', () => {
  it('서명된 경로면 201로 저장', async () => {
    const app = await appFor('internal')
    const path = `${HUB}/f/a.pdf`
    const res = await request(app).put(`/m/attachments/upload?hub=cs&path=${encodeURIComponent(path)}&token=${encodeURIComponent(await tokenFor(path))}`)
      .set('content-type', 'application/pdf').send(Buffer.from('PDF!'))
    expect(res.status).toBe(201)
    expect(readFileSync(join(root, path), 'utf8')).toBe('PDF!')
  })
  // 3/4 리뷰 이월(2026-11-10): 같은 토큰으로 다시 올리면 덮어쓰지 않는다(Supabase 서명 업로드처럼 409).
  it('이미 있는 경로에 다시 올리면 409, 처음 내용 유지', async () => {
    const app = await appFor('internal')
    const path = `${HUB}/f/once.pdf`
    const url = `/m/attachments/upload?hub=cs&path=${encodeURIComponent(path)}&token=${encodeURIComponent(await tokenFor(path))}`
    expect((await request(app).put(url).set('content-type', 'application/octet-stream').send(Buffer.from('first'))).status).toBe(201)
    expect((await request(app).put(url).set('content-type', 'application/octet-stream').send(Buffer.from('second'))).status).toBe(409)
    expect(readFileSync(join(root, path), 'utf8')).toBe('first')
  })

  it('토큰이 없거나 다른 경로 것이면 403', async () => {
    const app = await appFor('internal')
    const path = `${HUB}/f/a.pdf`
    expect((await request(app).put(`/m/attachments/upload?hub=cs&path=${encodeURIComponent(path)}`).send(Buffer.from('x'))).status).toBe(403)
    const other = await tokenFor(`${HUB}/f/b.pdf`)
    expect((await request(app).put(`/m/attachments/upload?hub=cs&path=${encodeURIComponent(path)}&token=${encodeURIComponent(other)}`).send(Buffer.from('x'))).status).toBe(403)
    expect(existsSync(join(root, path))).toBe(false)
  })
  it('다른 허브 경로면(토큰이 맞아도) 403', async () => {
    const app = await appFor('internal')
    const path = `${OTHER}/f/a.pdf`
    const res = await request(app).put(`/m/attachments/upload?hub=cs&path=${encodeURIComponent(path)}&token=${encodeURIComponent(await tokenFor(path))}`).send(Buffer.from('x'))
    expect(res.status).toBe(403)
  })
  // 리뷰(2026-11-09): JSON 파서가 먼저 본문을 가져가면 빈 파일이 201로 저장됐다 — 400으로 막는다.
  it('본문이 바이트가 아니면(application/json 등) 400, 저장하지 않는다', async () => {
    const app = await appFor('internal')
    app.use(express.json())
    const path = `${HUB}/f/j.json`
    const a2 = express()
    a2.use(express.json())
    const { default: router } = await import('./router.js')
    a2.use('/m', router)
    const res = await request(a2).put(`/m/attachments/upload?hub=cs&path=${encodeURIComponent(path)}&token=${encodeURIComponent(await tokenFor(path))}`)
      .set('content-type', 'application/json').send({ a: 1 })
    expect(res.status).toBe(400)
    expect(existsSync(join(root, path))).toBe(false)
  })

  it('10MB를 넘으면 413', async () => {
    const app = await appFor('internal')
    const path = `${HUB}/f/big.bin`
    const res = await request(app).put(`/m/attachments/upload?hub=cs&path=${encodeURIComponent(path)}&token=${encodeURIComponent(await tokenFor(path))}`)
      .set('content-type', 'application/octet-stream').send(Buffer.alloc(10 * 1024 * 1024 + 1))
    expect(res.status).toBe(413)
  })
})

describe('외부 에디션', () => {
  it('업로드 엔드포인트가 없다(404)', async () => {
    const app = await appFor('external')
    const path = `${HUB}/f/a.pdf`
    const res = await request(app).put(`/m/attachments/upload?hub=cs&path=${encodeURIComponent(path)}&token=x`).send(Buffer.from('x'))
    expect(res.status).toBe(404)
  })
})
