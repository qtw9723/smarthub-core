// server/modules/mailer/attachmentRoutes.test.js — 첨부 서명·삭제 경로의 허브 경계.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

const HUB_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_HUB = '99999999-9999-4999-8999-999999999999'
const FOLDER = '22222222-2222-4222-8222-222222222222'

const mockFrom = vi.hoisted(() => vi.fn())
const mockSign = vi.hoisted(() => vi.fn(async (path) => ({ data: { path, token: 'tok' }, error: null })))
const mockRemove = vi.hoisted(() => vi.fn(async () => ({ error: null })))
vi.mock('../../db.js', () => ({
  default: {
    from: mockFrom,
    storage: { from: () => ({ createSignedUploadUrl: mockSign, remove: mockRemove, download: vi.fn() }) },
  },
}))
vi.mock('./smtp.js', () => ({ sendMail: vi.fn() }))

// 이 허브의 잡이 참조하는 구 경로 — contains() 결과로 돌려줄 값
let legacyRefs = []
function makeApp(router) {
  const app = express()
  app.use(express.json())
  app.use('/api/modules/mailer', router)
  return app
}

let app
beforeEach(async () => {
  vi.clearAllMocks()
  legacyRefs = []
  mockFrom.mockImplementation((table) => {
    if (table === 'hubs') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { id: HUB_ID, key: 'cs', password_hash: null }, error: null }),
      }
    }
    // mail_jobs — 구 경로 소유 확인용
    const p = Promise.resolve({ data: legacyRefs, error: null })
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      contains: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      then: (res, rej) => p.then(res, rej),
    }
  })
  const { default: router } = await import('./router.js')
  app = makeApp(router)
})

describe('POST /attachments/sign-upload', () => {
  it('허브 id를 접두사로 한 경로와 토큰을 준다', async () => {
    const res = await request(app).post('/api/modules/mailer/attachments/sign-upload?hub=cs')
      .send({ folder: FOLDER, filename: '보고서.pdf', size: 100 })
    expect(res.status).toBe(200)
    expect(res.body.path).toMatch(new RegExp(`^${HUB_ID}/${FOLDER}/`))
    expect(res.body.token).toBe('tok')
  })

  it('클라이언트가 경로를 직접 지정해도 무시한다', async () => {
    const res = await request(app).post('/api/modules/mailer/attachments/sign-upload?hub=cs')
      .send({ folder: FOLDER, filename: 'a.pdf', size: 1, path: `${OTHER_HUB}/x/evil.pdf` })
    expect(res.body.path).toMatch(new RegExp(`^${HUB_ID}/`))
  })

  it('10MB를 넘으면 400 — 서명 자체를 내주지 않는다', async () => {
    const res = await request(app).post('/api/modules/mailer/attachments/sign-upload?hub=cs')
      .send({ folder: FOLDER, filename: 'a.pdf', size: 10 * 1024 * 1024 + 1 })
    expect(res.status).toBe(400)
    expect(mockSign).not.toHaveBeenCalled()
  })

  it('폴더가 UUID가 아니면 400', async () => {
    const res = await request(app).post('/api/modules/mailer/attachments/sign-upload?hub=cs')
      .send({ folder: '../escape', filename: 'a.pdf', size: 1 })
    expect(res.status).toBe(400)
    expect(mockSign).not.toHaveBeenCalled()
  })
})

describe('DELETE /attachments', () => {
  it('제 허브 경로는 지운다', async () => {
    const path = `${HUB_ID}/${FOLDER}/a.png`
    const res = await request(app).delete('/api/modules/mailer/attachments?hub=cs').send({ path })
    expect(res.status).toBe(204)
    expect(mockRemove).toHaveBeenCalledWith([path])
  })

  it('다른 허브 경로는 403 — 실제로 지우지 않는다', async () => {
    const res = await request(app).delete('/api/modules/mailer/attachments?hub=cs')
      .send({ path: `${OTHER_HUB}/${FOLDER}/a.png` })
    expect(res.status).toBe(403)
    expect(mockRemove).not.toHaveBeenCalled()
  })

  it('구 경로(2단)는 이 허브 잡이 참조할 때만 지운다', async () => {
    legacyRefs = [{ id: 'job-1' }]
    const path = `${FOLDER}/a.png`
    const res = await request(app).delete('/api/modules/mailer/attachments?hub=cs').send({ path })
    expect(res.status).toBe(204)
    expect(mockRemove).toHaveBeenCalledWith([path])
  })

  it('아무 잡도 참조하지 않는 구 경로는 403', async () => {
    legacyRefs = []
    const res = await request(app).delete('/api/modules/mailer/attachments?hub=cs')
      .send({ path: `${FOLDER}/a.png` })
    expect(res.status).toBe(403)
    expect(mockRemove).not.toHaveBeenCalled()
  })
})
