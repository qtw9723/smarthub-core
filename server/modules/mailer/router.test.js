// server/modules/mailer/router.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

const mockFrom = vi.hoisted(() => vi.fn())
const mockStorageRemove = vi.hoisted(() => vi.fn(async () => ({ error: null })))
vi.mock('../../db.js', () => ({
  default: {
    from: mockFrom,
    storage: { from: () => ({ remove: mockStorageRemove }) },
  },
}))
const mockSendMail = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('./smtp.js', () => ({ sendMail: mockSendMail }))

const HUB_ID = 'hub-cs-id'

function mockQuery(result) {
  const p = Promise.resolve(result)
  return {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
    then: (resolve, reject) => p.then(resolve, reject),
  }
}

let queued = []
function queue(...qs) { queued.push(...qs) }
function defaultFromImpl(table) {
  if (table === 'hubs') return mockQuery({ data: { id: HUB_ID }, error: null })
  return queued.shift() ?? mockQuery({ data: null, error: null })
}
mockFrom.mockImplementation(defaultFromImpl)

const { default: mailerRouter } = await import('./router.js')
const { hashPassword } = await import('../../lib/hubPassword.js')
const app = express()
app.use(express.json())
app.use('/api/modules/mailer', mailerRouter)

const AUTH = { 'x-app-password': 'test-pw' }

beforeEach(() => {
  vi.clearAllMocks()
  queued = []
  mockFrom.mockImplementation(defaultFromImpl)
  mockStorageRemove.mockClear()
  mockSendMail.mockClear()
  mockSendMail.mockResolvedValue(undefined)
  process.env.APP_PASSWORD = 'test-pw'
  process.env.CRON_SECRET = 'test-cron-secret'
})

// 인증 경계: 이 모듈 API는 **대상 허브의 비밀번호**를 요구한다(판정 자체는
// server/lib/hubAuth.test.js). 여기서는 미들웨어가 걸려 있는지만 확인한다.
// 자동 트리거(tick)의 Bearer CRON_SECRET은 별개 비밀이며 아래에서 따로 검증한다.
describe('인증 경계 — 허브 비밀번호', () => {
  const CS_HASH = hashPassword('cs-pw')
  const lockHub = () => mockFrom.mockImplementation((table) => (
    table === 'hubs'
      ? mockQuery({ data: { id: HUB_ID, key: 'cs', name: 'CS', password_hash: CS_HASH }, error: null })
      : queued.shift() ?? mockQuery({ data: null, error: null })
  ))

  it('비밀번호 없는 허브는 공개 — 401이 아니다', async () => {
    queue(mockQuery({ data: [], error: null }), mockQuery({ data: [], error: null }))
    expect((await request(app).get('/api/modules/mailer/jobs')).status).not.toBe(401)
  })

  it('비밀번호가 걸린 허브는 401', async () => {
    lockHub()
    const res = await request(app).get('/api/modules/mailer/jobs')
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('HUB_PASSWORD_REQUIRED')
  })

  it('맞는 허브 비밀번호면 통과', async () => {
    lockHub()
    queue(mockQuery({ data: [], error: null }), mockQuery({ data: [], error: null }))
    expect((await request(app).get('/api/modules/mailer/jobs').set('x-hub-password', 'cs-pw')).status).toBe(200)
  })
})

describe('GET /jobs', () => {
  it('hub 스코프 조회 + send_log에서 recent_sends(최대 10개, 오래된→최신) 병합', async () => {
    const jobsQ = mockQuery({ data: [{ id: 'j1', name: 'A', hub_id: HUB_ID }], error: null })
    const logsQ = mockQuery({
      data: [
        { job_id: 'j1', ok: true, sent_at: '2026-07-20T00:00:00Z' },
        { job_id: 'j1', ok: false, sent_at: '2026-07-19T00:00:00Z' },
      ],
      error: null,
    })
    queue(jobsQ, logsQ)
    const res = await request(app).get('/api/modules/mailer/jobs').set(AUTH)
    expect(res.status).toBe(200)
    expect(jobsQ.eq).toHaveBeenCalledWith('hub_id', HUB_ID)
    expect(res.body[0].recent_sends.map((s) => s.ok)).toEqual([false, true])
  })

  it('job이 없으면 send_log는 조회하지 않고 빈 배열 반환', async () => {
    queue(mockQuery({ data: [], error: null }))
    const res = await request(app).get('/api/modules/mailer/jobs').set(AUTH)
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('알 수 없는 hub → 404', async () => {
    mockFrom.mockImplementationOnce(() => mockQuery({ data: null, error: null }))
    const res = await request(app).get('/api/modules/mailer/jobs?hub=nope').set(AUTH)
    expect(res.status).toBe(404)
  })
})

describe('POST /jobs', () => {
  it('hub_id를 주입해 생성 + 201', async () => {
    const q = mockQuery({ data: { id: 'j1', hub_id: HUB_ID, name: 'A' }, error: null })
    queue(q)
    const res = await request(app).post('/api/modules/mailer/jobs').set(AUTH).send({
      name: 'A', sender: 's@x.com', subject: 'sub', body: 'b', recipients: ['a@b.c'], interval_minutes: 60,
    })
    expect(res.status).toBe(201)
    expect(q.insert).toHaveBeenCalledWith(expect.objectContaining({ hub_id: HUB_ID, name: 'A' }))
  })

  it("body_format 미지정이면 'text'로 저장(기존 클라이언트 하위호환)", async () => {
    const q = mockQuery({ data: { id: 'j1' }, error: null })
    queue(q)
    await request(app).post('/api/modules/mailer/jobs').set(AUTH).send({
      name: 'A', sender: 's@x.com', subject: 'sub', body: 'b', recipients: ['a@b.c'], interval_minutes: 60,
    })
    expect(q.insert).toHaveBeenCalledWith(expect.objectContaining({ body_format: 'text' }))
  })

  it("body_format 'html'을 저장한다", async () => {
    const q = mockQuery({ data: { id: 'j1' }, error: null })
    queue(q)
    await request(app).post('/api/modules/mailer/jobs').set(AUTH).send({
      name: 'A', sender: 's@x.com', subject: 'sub', body: '<p>b</p>', body_format: 'html',
      recipients: ['a@b.c'], interval_minutes: 60,
    })
    expect(q.insert).toHaveBeenCalledWith(expect.objectContaining({ body_format: 'html' }))
  })

  // DB CHECK가 최종 방어선이지만 여기서 걸러야 오류가 사용자에게 의미 있게 전달된다.
  it('알 수 없는 body_format이면 400', async () => {
    const res = await request(app).post('/api/modules/mailer/jobs').set(AUTH).send({
      name: 'A', sender: 's@x.com', subject: 'sub', body: 'b', body_format: 'markdown',
      recipients: ['a@b.c'], interval_minutes: 60,
    })
    expect(res.status).toBe(400)
  })
})

describe('PATCH /jobs/:id', () => {
  it('허용 필드만 갱신(send_count 포함) + hub_id 스코프', async () => {
    const q = mockQuery({ data: [{ id: 'j1', send_count: 5 }], error: null })
    queue(q)
    const res = await request(app).patch('/api/modules/mailer/jobs/j1').set(AUTH).send({ send_count: 5, id: 'hack' })
    expect(res.status).toBe(200)
    expect(q.update).toHaveBeenCalledWith({ send_count: 5 })
    expect(q.eq).toHaveBeenCalledWith('hub_id', HUB_ID)
  })

  it('유효 필드가 없으면 400', async () => {
    const res = await request(app).patch('/api/modules/mailer/jobs/j1').set(AUTH).send({ id: 'hack', foo: 'bar' })
    expect(res.status).toBe(400)
  })

  it('body_format을 갱신할 수 있다', async () => {
    const q = mockQuery({ data: [{ id: 'j1' }], error: null })
    queue(q)
    const res = await request(app).patch('/api/modules/mailer/jobs/j1').set(AUTH).send({ body_format: 'html' })
    expect(res.status).toBe(200)
    expect(q.update).toHaveBeenCalledWith({ body_format: 'html' })
  })

  it('알 수 없는 body_format이면 400', async () => {
    const res = await request(app).patch('/api/modules/mailer/jobs/j1').set(AUTH).send({ body_format: 'markdown' })
    expect(res.status).toBe(400)
  })

  it('다른 hub 소속 잡(스코프 밖)이면 404', async () => {
    const q = mockQuery({ data: [], error: null })
    queue(q)
    const res = await request(app).patch('/api/modules/mailer/jobs/j1').set(AUTH).send({ is_active: false })
    expect(res.status).toBe(404)
  })
})

describe('DELETE /jobs/:id', () => {
  it('다른 hub 소속(조회 안 됨)이면 404', async () => {
    queue(mockQuery({ data: null, error: null }))
    const res = await request(app).delete('/api/modules/mailer/jobs/j1').set(AUTH)
    expect(res.status).toBe(404)
  })

  it('성공 시 200 + hub_id 스코프로 삭제', async () => {
    const selQ = mockQuery({ data: { id: 'j1', hub_id: HUB_ID, attachments: [] }, error: null })
    const delQ = mockQuery({ error: null })
    queue(selQ, delQ)
    const res = await request(app).delete('/api/modules/mailer/jobs/j1').set(AUTH)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })
    expect(delQ.eq).toHaveBeenCalledWith('hub_id', HUB_ID)
  })

  it('첨부파일이 있으면 storage에서 제거 후 삭제', async () => {
    const selQ = mockQuery({ data: { id: 'j1', hub_id: HUB_ID, attachments: [{ path: 'a/b.png' }] }, error: null })
    const delQ = mockQuery({ error: null })
    queue(selQ, delQ)
    const res = await request(app).delete('/api/modules/mailer/jobs/j1').set(AUTH)
    expect(res.status).toBe(200)
    expect(mockStorageRemove).toHaveBeenCalledWith(['a/b.png'])
  })
})

describe('GET /senders', () => {
  it('app_password를 마스킹해 반환 + hub 스코프', async () => {
    const q = mockQuery({ data: [{ id: 's1', email: 'a@b.c', created_at: '2026-01-01' }], error: null })
    queue(q)
    const res = await request(app).get('/api/modules/mailer/senders').set(AUTH)
    expect(res.status).toBe(200)
    expect(q.select).toHaveBeenCalledWith('id, email, created_at')
    expect(q.eq).toHaveBeenCalledWith('hub_id', HUB_ID)
    expect(res.body[0]).not.toHaveProperty('app_password')
  })
})

describe('POST /senders', () => {
  it('hub_id를 주입해 생성하고 마스킹된 응답', async () => {
    const q = mockQuery({ data: { id: 's1', email: 'a@b.c', created_at: '2026-01-01' }, error: null })
    queue(q)
    const res = await request(app).post('/api/modules/mailer/senders').set(AUTH).send({ email: 'a@b.c', app_password: 'secret' })
    expect(res.status).toBe(201)
    expect(q.insert).toHaveBeenCalledWith({ hub_id: HUB_ID, email: 'a@b.c', app_password: 'secret' })
    expect(res.body).not.toHaveProperty('app_password')
  })
})

describe('DELETE /senders/:id', () => {
  it('hub_id 스코프로 삭제', async () => {
    const q = mockQuery({ data: [{ id: 's1', hub_id: HUB_ID }], error: null })
    queue(q)
    const res = await request(app).delete('/api/modules/mailer/senders/s1').set(AUTH)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })
    expect(q.eq).toHaveBeenCalledWith('hub_id', HUB_ID)
  })

  it('다른 hub 소속/존재하지 않는 sender면 404', async () => {
    const q = mockQuery({ data: [], error: null })
    queue(q)
    const res = await request(app).delete('/api/modules/mailer/senders/s1').set(AUTH)
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'not found' })
  })
})

describe('GET /tick', () => {
  it('Bearer 헤더 없으면 401', async () => {
    const res = await request(app).get('/api/modules/mailer/tick')
    expect(res.status).toBe(401)
  })

  it('잘못된 Bearer 시크릿이면 401', async () => {
    const res = await request(app).get('/api/modules/mailer/tick').set('Authorization', 'Bearer wrong-secret')
    expect(res.status).toBe(401)
  })

  it('interval 경과한 job만 처리(due)하고 최근 발송된 job은 skip + claim 성공 후 발송 + send_log 기록', async () => {
    const now = Date.now()
    const dueJob = {
      id: 'job-due', hub_id: HUB_ID, sender: 'gmail', sender_account_id: null,
      subject: 'S', body: 'B', recipients: ['r1@x.com'], interval_minutes: 60,
      use_index: false, attachments: [], send_count: 0,
      last_sent_at: new Date(now - 120 * 60_000).toISOString(),
    }
    const notDueJob = {
      id: 'job-not-due', hub_id: HUB_ID, sender: 'gmail', sender_account_id: null,
      subject: 'S2', body: 'B2', recipients: ['r2@x.com'], interval_minutes: 60,
      use_index: false, attachments: [], send_count: 0,
      last_sent_at: new Date(now - 5 * 60_000).toISOString(),
    }
    const jobsQ = mockQuery({ data: [dueJob, notDueJob], error: null })
    const claimQ = mockQuery({ data: [{ id: 'job-due' }], error: null })
    const logQ = mockQuery({ data: null, error: null })
    queue(jobsQ, claimQ, logQ)

    const res = await request(app).get('/api/modules/mailer/tick').set('Authorization', 'Bearer test-cron-secret')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ processed: 1, failed: 0 })
    expect(mockSendMail).toHaveBeenCalledTimes(1)
    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'r1@x.com', subject: 'S', body: 'B' }))
    // claim(CAS) update: 선점 이전 값(last_sent_at)을 가드로 걸어 이 id/hub 행만 갱신
    expect(claimQ.update).toHaveBeenCalledWith(expect.objectContaining({ send_count: 1 }))
    expect(claimQ.eq).toHaveBeenCalledWith('id', 'job-due')
    expect(claimQ.eq).toHaveBeenCalledWith('hub_id', HUB_ID)
    expect(claimQ.eq).toHaveBeenCalledWith('last_sent_at', dueJob.last_sent_at)
    expect(claimQ.select).toHaveBeenCalled()
    // claim이 발송보다 먼저 일어나야 함(선점 후 발송)
    expect(claimQ.update.mock.invocationCallOrder[0]).toBeLessThan(mockSendMail.mock.invocationCallOrder[0])
    expect(logQ.insert).toHaveBeenCalledWith(expect.objectContaining({ job_id: 'job-due', ok: true }))
  })

  it('last_sent_at이 null인 job은 CAS 가드로 .is(last_sent_at, null)을 사용', async () => {
    const job = {
      id: 'job-acc', hub_id: HUB_ID, sender: null, sender_account_id: 'acc-1',
      subject: 'S', body: 'B', recipients: ['r1@x.com'], interval_minutes: 10,
      use_index: false, attachments: [], send_count: 2,
      last_sent_at: null,
    }
    const jobsQ = mockQuery({ data: [job], error: null })
    const claimQ = mockQuery({ data: [{ id: 'job-acc' }], error: null })
    const acctQ = mockQuery({ data: { id: 'acc-1', email: 'sender@x.com', app_password: 'pw123' }, error: null })
    const logQ = mockQuery({ data: null, error: null })
    queue(jobsQ, claimQ, acctQ, logQ)

    const res = await request(app).get('/api/modules/mailer/tick').set('Authorization', 'Bearer test-cron-secret')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ processed: 1, failed: 0 })
    expect(claimQ.is).toHaveBeenCalledWith('last_sent_at', null)
    expect(acctQ.eq).toHaveBeenCalledWith('id', 'acc-1')
    expect(acctQ.eq).toHaveBeenCalledWith('hub_id', HUB_ID)
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({ senderEmail: 'sender@x.com', senderPassword: 'pw123', to: 'r1@x.com' })
    )
  })

  it('job의 body_format을 발송부로 전달한다', async () => {
    const job = {
      id: 'job-html', hub_id: HUB_ID, sender: 'gmail', sender_account_id: null,
      subject: 'S', body: '<p>B</p>', body_format: 'html', recipients: ['r1@x.com'],
      interval_minutes: 10, use_index: false, attachments: [], send_count: 0, last_sent_at: null,
    }
    queue(mockQuery({ data: [job], error: null }), mockQuery({ data: [{ id: 'job-html' }], error: null }), mockQuery({ data: null, error: null }))

    await request(app).get('/api/modules/mailer/tick').set('Authorization', 'Bearer test-cron-secret')

    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({ body: '<p>B</p>', bodyFormat: 'html' }))
  })

  it('CAS claim이 0행을 반환하면(다른 tick이 이미 선점) 발송/로그 없이 skip', async () => {
    const now = Date.now()
    const dueJob = {
      id: 'job-race', hub_id: HUB_ID, sender: 'gmail', sender_account_id: null,
      subject: 'S', body: 'B', recipients: ['r1@x.com'], interval_minutes: 60,
      use_index: false, attachments: [], send_count: 0,
      last_sent_at: new Date(now - 120 * 60_000).toISOString(),
    }
    const jobsQ = mockQuery({ data: [dueJob], error: null })
    const claimQ = mockQuery({ data: [], error: null }) // 0행: 이미 다른 tick이 선점
    queue(jobsQ, claimQ)

    const res = await request(app).get('/api/modules/mailer/tick').set('Authorization', 'Bearer test-cron-secret')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ processed: 1, failed: 0 })
    expect(mockSendMail).not.toHaveBeenCalled()
    expect(mockFrom.mock.calls.some((c) => c[0] === 'send_log')).toBe(false)
  })

  it('claim 성공 후 발송 실패 시 send_log ok=false 기록 + claim은 되돌리지 않음(추가 update 없음)', async () => {
    const now = Date.now()
    const dueJob = {
      id: 'job-fail', hub_id: HUB_ID, sender: 'gmail', sender_account_id: null,
      subject: 'S', body: 'B', recipients: ['r1@x.com'], interval_minutes: 60,
      use_index: false, attachments: [], send_count: 0,
      last_sent_at: new Date(now - 120 * 60_000).toISOString(),
    }
    const jobsQ = mockQuery({ data: [dueJob], error: null })
    const claimQ = mockQuery({ data: [{ id: 'job-fail' }], error: null })
    const logQ = mockQuery({ data: null, error: null })
    queue(jobsQ, claimQ, logQ)
    mockSendMail.mockRejectedValueOnce(new Error('smtp down'))

    const res = await request(app).get('/api/modules/mailer/tick').set('Authorization', 'Bearer test-cron-secret')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ processed: 1, failed: 1 })
    expect(logQ.insert).toHaveBeenCalledWith(expect.objectContaining({ job_id: 'job-fail', ok: false, error: expect.stringContaining('smtp down') }))
    // mail_jobs에 대한 update 호출은 claim 1회뿐 — 실패해도 되돌리는 2차 update가 없어야 함
    expect(mockFrom.mock.calls.filter((c) => c[0] === 'mail_jobs').length).toBe(2) // select(list) + claim(update)
  })

  it('알 수 없는 hub → 404', async () => {
    mockFrom.mockImplementationOnce(() => mockQuery({ data: null, error: null }))
    const res = await request(app)
      .get('/api/modules/mailer/tick?hub=nope')
      .set('Authorization', 'Bearer test-cron-secret')
    expect(res.status).toBe(404)
  })
})
