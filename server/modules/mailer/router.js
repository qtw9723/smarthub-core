// server/modules/mailer/router.js
import express, { Router } from 'express'
import { requireHubAccess } from '../../lib/hubAuth.js'
import { guardAsyncRouter, finalizeAsyncRouter } from '../../lib/asyncRoute.js'
import { attachments } from '../../editions/attachments.js'
import { edition } from '../../edition.js'
import { sendMail } from './smtp.js'
import { buildAttachmentPath, validateUploadRequest, hubIdOfPath, MAX_FILE_SIZE } from './attachmentPath.js'
import { repos } from '../../data/index.js'
import { forEachHub, isAllHubs } from '../../lib/forEachHub.js'

// grafana-reports에서 실측된 것과 같은 모양이다: 핸들러가 try 밖에서 await를 부르고,
// Express 4는 async 거부를 잡지 않아 응답 없이 요청이 매달린다(서버리스 = 60초 태우고 504).
// 지금 이 라우터의 try 밖 await는 resolveHubId뿐이고 그것은 오류를 null로 돌려주지만,
// 네트워크 실패로는 거부할 수 있다. 안전망을 라우터 차원에 둔다.
const router = guardAsyncRouter(Router(), 'mailer')
const DEFAULT_HUB = 'cs'

// 이 모듈 API는 **대상 허브의 비밀번호**를 요구한다(hubs.password_hash).
// 비밀번호가 설정되지 않은 허브는 공개고, APP_PASSWORD는 마스터키다.
// 자동 트리거(Bearer CRON_SECRET)는 이 검사를 지나가며 그 인가는 cronAuth가 한다.
// 전체 경계: README "인증 경계".
router.use(requireHubAccess(DEFAULT_HUB))
const ALLOWED_JOB_PATCH_FIELDS = new Set([
  'name','sender','sender_account_id','subject','body','body_format','recipients',
  'interval_minutes','use_index','attachments','is_active','sort_order','send_count',
])
// DB CHECK가 최종 방어선이지만, 여기서 먼저 걸러야 사용자에게 의미 있는 오류가 간다.
const BODY_FORMATS = new Set(['text', 'html'])
const invalidBodyFormat = (v) => v !== undefined && !BODY_FORMATS.has(v)
// 이 모듈 API는 APP_PASSWORD를 요구하지 않는다 — 허브(/hub/:hubKey)가 공개이고
// 허브 페이지가 곧 이 API의 소비자이기 때문이다. 비밀번호는 플랫폼 진입점
// (허브 목록 `/` · 백오피스 `/admin` → /api/admin/*)만 지킨다.
// 자동 트리거용 Bearer CRON_SECRET 검사는 별개 비밀이며 그대로 유지된다.
const hubCache = new Map()
async function resolveHubId(key) {
  const k = key || DEFAULT_HUB
  if (hubCache.has(k)) return hubCache.get(k)
  // 조회 오류도 '없음'으로 본다(이전과 같은 동작 — 호출자가 404).
  const id = await repos.hubs.getHubId(k).catch(() => null)
  if (!id) return null
  hubCache.set(k, id); return id
}
const hubKeyOf = (req) => req.query.hub || req.body?.hub || DEFAULT_HUB

router.get('/jobs', async (req, res) => {
  const hubId = await resolveHubId(hubKeyOf(req)); if (!hubId) return res.status(404).json({ error: 'unknown hub' })
  try {
    const data = await repos.mailer.listJobs(hubId)
    const byJob = new Map(data.map(j => [j.id, []]))
    if (data.length) {
      // 최근 발송 기록 조회 실패는 기록 없이 보여 준다(이전 동작).
      const logs = await repos.mailer.listRecentSends(data.map(j => j.id), Math.min(data.length * 10, 300)).catch(() => [])
      for (const row of logs) { const l = byJob.get(row.job_id); if (l && l.length < 10) l.push({ ok: row.ok, sent_at: row.sent_at }) }
    }
    res.json(data.map(j => ({ ...j, recent_sends: byJob.get(j.id).reverse() })))
  } catch (e) { res.status(500).json({ error: e.message }) }
})
router.post('/jobs', async (req, res) => {
  const hubId = await resolveHubId(hubKeyOf(req)); if (!hubId) return res.status(404).json({ error: 'unknown hub' })
  const { name, sender, sender_account_id, subject, body, body_format, recipients, interval_minutes, use_index, attachments } = req.body
  if (invalidBodyFormat(body_format)) return res.status(400).json({ error: 'invalid body_format' })
  try {
    const data = await repos.mailer.createJob(hubId, {
      name, sender, subject, body, recipients, interval_minutes,
      body_format: body_format ?? 'text',
      sender_account_id: sender_account_id || null, use_index: use_index ?? false, attachments: attachments ?? [],
    })
    res.status(201).json(data)
  } catch (e) { res.status(500).json({ error: e.message }) }
})
router.patch('/jobs/:id', async (req, res) => {
  const hubId = await resolveHubId(hubKeyOf(req)); if (!hubId) return res.status(404).json({ error: 'unknown hub' })
  const keys = Object.keys(req.body).filter(k => ALLOWED_JOB_PATCH_FIELDS.has(k))
  if (!keys.length) return res.status(400).json({ error: 'no valid fields' })
  if (invalidBodyFormat(req.body.body_format)) return res.status(400).json({ error: 'invalid body_format' })
  const updateObj = Object.fromEntries(keys.map(k => [k, req.body[k]]))
  try {
    const job = await repos.mailer.updateJob(hubId, req.params.id, updateObj)
    if (!job) return res.status(404).json({ error: 'not found' })
    res.json(job)
  } catch (e) { res.status(500).json({ error: e.message }) }
})
router.delete('/jobs/:id', async (req, res) => {
  const hubId = await resolveHubId(hubKeyOf(req)); if (!hubId) return res.status(404).json({ error: 'unknown hub' })
  try {
    // 조회 오류는 '없음'과 같게 본다(이전 동작 — 404).
    const job = await repos.mailer.getJob(hubId, req.params.id).catch(() => null)
    if (!job) return res.status(404).json({ error: 'not found' })
    // 첨부 정리 실패는 잡 삭제를 막지 않는다(이전 동작 — 오류를 보지 않았다).
    if (job.attachments?.length) await attachments.remove(job.attachments.map(a => a.path)).catch(() => {})
    await repos.mailer.deleteJob(hubId, req.params.id)
    res.json({ success: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
// ── 첨부 파일 ──────────────────────────────────────────────────────────────
// 브라우저가 anon 키로 Storage에 직접 쓰던 것을 서버 인가로 바꿨다(ROADMAP v0.5.0).
// anon 키는 번들에 실려 나가므로, 예전 방식에서는 누구든 버킷 전체를 읽고 쓰고 지울 수 있었다.
//
// 바이트는 여전히 브라우저 → Storage로 **직접** 간다. 서버로 프록시하면 Vercel 서버리스의
// 요청 본문 상한(4.5MB)에 걸려 10MB 계약이 깨지기 때문이다. 서버를 지나는 것은 **인가**뿐이다.
router.post('/attachments/sign-upload', async (req, res) => {
  const hubId = await resolveHubId(hubKeyOf(req)); if (!hubId) return res.status(404).json({ error: 'unknown hub' })
  const { folder, filename, size } = req.body ?? {}
  const problem = validateUploadRequest({ folder, filename, size })
  if (problem) return res.status(400).json({ error: problem })
  try {
    // 경로는 **서버가** 만든다 — 클라이언트가 보낸 path는 쓰지 않는다.
    const path = buildAttachmentPath(hubId, folder, filename)
    // 외부: { method: 'supabase-signed', path, token } — 브라우저가 Storage로 직접 올린다.
    // 사내: { method: 'server', path, uploadUrl } — 브라우저가 이 서버로 PUT한다.
    res.json(await attachments.signUpload(path))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// PUT /attachments/upload — **사내 전용**. 브라우저가 sign-upload에서 받은 주소로 파일 바이트를 보낸다.
// 토큰은 서버가 만든 경로·만료에 묶여 있고(서명 업로드 URL과 같은 역할), 경로의 허브가 요청 허브와 같아야 한다.
// 외부 에디션은 바이트가 Supabase Storage로 직접 가므로 이 경로가 없다(404).
const rawUpload = express.raw({ type: () => true, limit: MAX_FILE_SIZE })
router.put('/attachments/upload', (req, res, next) => {
  if (edition() !== 'internal') return res.status(404).json({ error: 'not found' })
  rawUpload(req, res, (err) => {
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: '파일이 10MB를 넘습니다' })
    next(err)
  })
}, async (req, res) => {
  const hubId = await resolveHubId(hubKeyOf(req)); if (!hubId) return res.status(404).json({ error: 'unknown hub' })
  const path = req.query.path
  const { verifyToken } = await import('../../editions/internal/uploadToken.js')
  const { signingSecret } = await import('../../editions/internal/attachments.js')
  if (typeof path !== 'string' || !verifyToken(path, req.query.token, signingSecret())) {
    return res.status(403).json({ error: '업로드 권한이 없습니다(서명 없음·만료·경로 불일치)' })
  }
  if (hubIdOfPath(path) !== hubId) return res.status(403).json({ error: '다른 허브의 첨부입니다' })
  // 다른 파서(전역 JSON 등)가 본문을 먼저 가져갔으면 바이트가 없다 — 빈 파일을 저장하지 않고 거절한다.
  if (!Buffer.isBuffer(req.body)) return res.status(400).json({ error: '파일 바이트를 application/octet-stream으로 보내야 합니다' })
  try {
    await attachments.write(path, req.body)
    res.status(201).json({ path })
  } catch (e) {
    if (e.code === 'EEXIST') return res.status(409).json({ error: '이미 올린 파일입니다' })
    res.status(500).json({ error: e.message })
  }
})

router.delete('/attachments', async (req, res) => {
  const hubId = await resolveHubId(hubKeyOf(req)); if (!hubId) return res.status(404).json({ error: 'unknown hub' })
  const path = req.body?.path
  if (typeof path !== 'string' || path === '') return res.status(400).json({ error: 'path가 필요합니다' })
  try {
    const owner = hubIdOfPath(path)
    if (owner) {
      if (owner !== hubId) return res.status(403).json({ error: '다른 허브의 첨부입니다' })
    } else {
      // 구 경로(2단)는 접두사로 허브를 알 수 없다. 이 허브의 잡이 참조할 때만 허용한다.
      if (!(await repos.mailer.hubHasAttachmentPath(hubId, path).catch(() => false))) return res.status(403).json({ error: '이 허브의 첨부가 아닙니다' })
    }
    await attachments.remove([path])
    res.status(204).end()
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.get('/senders', async (req, res) => {
  const hubId = await resolveHubId(hubKeyOf(req)); if (!hubId) return res.status(404).json({ error: 'unknown hub' })
  try {
    res.json(await repos.mailer.listSenders(hubId))
  } catch (e) { res.status(500).json({ error: e.message }) }
})
router.post('/senders', async (req, res) => {
  const hubId = await resolveHubId(hubKeyOf(req)); if (!hubId) return res.status(404).json({ error: 'unknown hub' })
  const { email, app_password } = req.body
  try {
    res.status(201).json(await repos.mailer.createSender(hubId, { email, app_password }))
  } catch (e) { res.status(500).json({ error: e.message }) }
})
router.delete('/senders/:id', async (req, res) => {
  const hubId = await resolveHubId(hubKeyOf(req)); if (!hubId) return res.status(404).json({ error: 'unknown hub' })
  try {
    if (!(await repos.mailer.deleteSender(hubId, req.params.id))) return res.status(404).json({ error: 'not found' })
    res.json({ success: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
router.get('/tick', async (req, res) => {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers['authorization'] !== `Bearer ${secret}`) return res.status(401).json({ error: 'unauthorized' })
  // ?hub=* — 메일러가 켜진 모든 허브(사내 CronJob). 그 밖은 지금처럼 허브 하나.
  if (isAllHubs(req)) return res.json({ hubs: await forEachHub('mailer', (h) => tickHub(h.id)) })
  const hubId = await resolveHubId(hubKeyOf(req)); if (!hubId) return res.status(404).json({ error: 'unknown hub' })
  try {
    res.json(await tickHub(hubId))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

async function tickHub(hubId) {
    const now = Date.now()
    const jobs = await repos.mailer.listActiveJobs(hubId)
    const due = jobs.filter(j => !j.last_sent_at || now >= new Date(j.last_sent_at).getTime() + j.interval_minutes * 60_000)
    const results = await Promise.allSettled(due.map(async (job) => {
      const logSend = async (ok, err = null) => { try { await repos.mailer.insertSendLog({ job_id: job.id, ok, error: err }) } catch { /* noop */ } }
      // 발송 슬롯 선점(claim-before-send): 발송 전에 먼저 DB를 갱신해 두어야
      // 크래시/DB쓰기실패/동시 tick이 겹쳐도 다음 tick이 재발송하지 않는다.
      // CAS 가드(이전 last_sent_at 값 일치)로, 다른 tick이 이미 선점했으면 0행 반환 → skip.
      const nextSendCount = job.send_count + 1
      const claimed = await repos.mailer.claimJobSend(hubId, job, new Date().toISOString())
      if (!claimed) return // 이미 다른 tick이 이 구간을 선점함 → 발송/로그 없이 skip
      try {
        const subject = job.use_index ? `[${nextSendCount}] ${job.subject}` : job.subject
        let sendOpts = { sender: job.sender }
        if (job.sender_account_id) {
          const acc = await repos.mailer.getSender(hubId, job.sender_account_id).catch(() => null)
          if (!acc) throw new Error(`Sender account not found: ${job.sender_account_id}`)
          sendOpts = { senderEmail: acc.email, senderPassword: acc.app_password }
        }
        for (const r of job.recipients) await sendMail({ ...sendOpts, to: r, subject, body: job.body, bodyFormat: job.body_format, attachments: job.attachments })
        await logSend(true)
      } catch (err) {
        // 발송 실패해도 선점은 되돌리지 않음(중복 발송 위험보다 발송 누락 한 사이클을 택함)
        await logSend(false, String(err?.message ?? err).slice(0, 500))
        throw err
      }
    }))
    return { processed: due.length, failed: results.filter(r => r.status === 'rejected').length }
}

finalizeAsyncRouter(router)

export default router
