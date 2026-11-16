// 저장소 계약 — 메일러(mail_jobs · send_log · sender_accounts). 두 구현이 같은 결과를 낸다.
import { it, expect } from 'vitest'
import { contractSuite } from './harness.js'

const NO_ID = '00000000-0000-4000-8000-000000000000'
const JOB = { name: 'J', sender: 'gmail', subject: 'S', body: 'B', recipients: ['a@x'], interval_minutes: 60, body_format: 'text', use_index: false, attachments: [], sender_account_id: null }

contractSuite('mailer', ({ repos, sql }) => {
  const m = () => repos().mailer
  const hub = async (key) => (await sql('insert into hubs (key, name) values ($1, $1) returning id', [key]))[0].id

  it('createJob → listJobs(sort_order asc, created_at desc) · getJob · 요약·이름 목록', async () => {
    const h = await hub('ops')
    const a = await m().createJob(h, { ...JOB, name: 'A' })
    const b = await m().createJob(h, { ...JOB, name: 'B' })
    await sql('update mail_jobs set sort_order = 1, created_at = now() - interval \'1 day\' where id = $1', [a.id])
    await sql('update mail_jobs set sort_order = 1 where id = $1', [b.id])
    expect(a).toMatchObject({ hub_id: h, name: 'A', recipients: ['a@x'], attachments: [], is_active: false, send_count: 0 })
    expect((await m().listJobs(h)).map((j) => j.name)).toEqual(['B', 'A'])
    expect((await m().getJob(h, a.id)).name).toBe('A')
    expect(await m().getJob(h, NO_ID)).toBeNull()
    expect((await m().listJobSummaries(h))[0]).toEqual(expect.objectContaining({ id: expect.any(String), name: expect.any(String), is_active: false }))
    expect(Object.keys((await m().listAllJobNames())[0]).sort()).toEqual(['hub_id', 'id', 'name'])
  })

  it('updateJob · deleteJob · listActiveJobs', async () => {
    const h = await hub('ops')
    const other = await hub('cs')
    const a = await m().createJob(h, JOB)
    expect((await m().updateJob(h, a.id, { is_active: true, subject: 'S2' })).subject).toBe('S2')
    expect(await m().updateJob(other, a.id, { subject: 'x' })).toBeNull()
    expect((await m().listActiveJobs(h)).map((j) => j.id)).toEqual([a.id])
    expect(await m().deleteJob(other, a.id)).toBe(false)
    expect(await m().deleteJob(h, a.id)).toBe(true)
  })

  it('hubHasAttachmentPath: 이 허브 잡의 첨부만 참 (다른 허브의 같은 경로는 거짓)', async () => {
    const h = await hub('ops')
    const other = await hub('cs')
    await m().createJob(other, { ...JOB, attachments: [{ path: 'old/x.pdf', name: 'x.pdf' }] })
    expect(await m().hubHasAttachmentPath(h, 'old/x.pdf')).toBe(false)
    await m().createJob(h, { ...JOB, attachments: [{ path: 'old/x.pdf', name: 'x.pdf' }, { path: 'old/y.pdf' }] })
    expect(await m().hubHasAttachmentPath(h, 'old/x.pdf')).toBe(true)
    expect(await m().hubHasAttachmentPath(h, 'old/z.pdf')).toBe(false)
  })

  it('claimJobSend: 선점하면 last_sent_at·send_count+1, 이미 선점된 값이면 null', async () => {
    const h = await hub('ops')
    const job = await m().createJob(h, JOB)
    const t1 = '2026-11-09T01:00:00.000Z'
    const claimed = await m().claimJobSend(h, job, t1)
    expect(claimed.send_count).toBe(1)
    expect(new Date(claimed.last_sent_at).toISOString()).toBe(t1)
    expect(await m().claimJobSend(h, job, t1)).toBeNull() // job.last_sent_at(null)은 이미 낡았다
    expect((await m().claimJobSend(h, claimed, '2026-11-09T02:00:00.000Z')).send_count).toBe(2)
  })

  it('동시 선점은 하나만 (last_sent_at null·값 두 경우)', async () => {
    const h = await hub('ops')
    const job = await m().createJob(h, JOB)
    const first = await Promise.all([m().claimJobSend(h, job, '2026-11-09T01:00:00.000Z'), m().claimJobSend(h, job, '2026-11-09T01:00:00.001Z')])
    expect(first.filter(Boolean)).toHaveLength(1)
    const cur = first.find(Boolean)
    const second = await Promise.all([m().claimJobSend(h, cur, '2026-11-09T03:00:00.000Z'), m().claimJobSend(h, cur, '2026-11-09T03:00:00.001Z')])
    expect(second.filter(Boolean)).toHaveLength(1)
  })

  it('send_log: insert → listRecentSends · listSendEvents (sent_at desc, limit)', async () => {
    const h = await hub('ops')
    const a = await m().createJob(h, JOB)
    await m().insertSendLog({ job_id: a.id, ok: true, error: null })
    await sql("update send_log set sent_at = now() - interval '1 hour'")
    await m().insertSendLog({ job_id: a.id, ok: false, error: 'boom' })
    const recent = await m().listRecentSends([a.id], 10)
    expect(recent.map((r) => r.ok)).toEqual([false, true])
    expect(Object.keys(recent[0]).sort()).toEqual(['job_id', 'ok', 'sent_at'])
    const events = await m().listSendEvents([a.id], 1)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ job_id: a.id, ok: false, error: 'boom' })
    expect(await m().listRecentSends([], 10)).toEqual([])
  })

  it('senders: create(비번 미반환) → list(created_at asc) · get(비번 포함) · delete · getDefaultSender', async () => {
    const h = await hub('ops')
    const other = await hub('cs')
    const s1 = await m().createSender(h, { email: 'a@x', app_password: 'pw1' })
    expect(Object.keys(s1).sort()).toEqual(['created_at', 'email', 'id'])
    await sql("update sender_accounts set created_at = now() - interval '1 day' where id = $1", [s1.id])
    await m().createSender(h, { email: 'b@x', app_password: 'pw2' })
    expect((await m().listSenders(h)).map((s) => s.email)).toEqual(['a@x', 'b@x'])
    expect((await m().getSender(h, s1.id)).app_password).toBe('pw1')
    expect(await m().getSender(other, s1.id)).toBeNull()
    expect(await m().getDefaultSender()).toEqual({ email: 'a@x', app_password: 'pw1' })
    expect(await m().deleteSender(other, s1.id)).toBe(false)
    expect(await m().deleteSender(h, s1.id)).toBe(true)
  })
})
