// server/routes/chatbot.js
import { Router } from 'express'
import { requireHubAccess } from '../../lib/hubAuth.js'
import { repos } from '../../data/index.js'
import { checkRunner } from '../../editions/checkRunner.js'
import { edition } from '../../edition.js'

const router = Router()

const ALLOWED_BOT_PATCH_FIELDS = new Set([
  'name', 'url', 'scenario', 'input_selector', 'enabled', 'sort_order', 'category',
])

const DEFAULT_HUB = 'delivery'

// 이 모듈 API는 **대상 허브의 비밀번호**를 요구한다(hubs.password_hash).
// 비밀번호가 설정되지 않은 허브는 공개고, APP_PASSWORD는 마스터키다.
// 자동 트리거(Bearer CRON_SECRET)는 이 검사를 지나가며 그 인가는 cronAuth가 한다.
// 전체 경계: README "인증 경계".
router.use(requireHubAccess(DEFAULT_HUB))

// pg_cron 등 자동 트리거용 인증 (Bearer CRON_SECRET)
function cronAuth(req, res, next) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers['authorization'] !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  next()
}

// 허브 key → id 해석 (짧게 캐시). key 없으면 delivery 기본값.
const hubCache = new Map()
async function resolveHubId(key) {
  const k = key || DEFAULT_HUB
  if (hubCache.has(k)) return hubCache.get(k)
  // 조회 오류도 '없음'으로 본다(이전과 같은 동작 — 호출자가 404).
  const id = await repos.hubs.getHubId(k).catch(() => null)
  if (!id) return null
  hubCache.set(k, id)
  return id
}

// 요청에서 허브 key 추출 (query > body > 기본값)
function hubKeyOf(req) {
  return req.query.hub || req.body?.hub || DEFAULT_HUB
}

// 점검 실행 — 외부는 GitHub Actions 워크플로우 디스패치, 사내는 k8s Job(server/editions/checkRunner.js).
const dispatchWorkflow = (inputs) => checkRunner.dispatch(inputs)
const dispatchLabel = () => (edition() === 'internal' ? '점검 Job 생성' : 'GitHub dispatch')
// 실행기를 쓸 수 없을 때의 안내. 외부 문구는 이전 그대로.
const unavailable = (long) => (edition() === 'internal'
  ? `${checkRunner.missing}이 없습니다 — 사내 점검은 클러스터 안에서만 실행할 수 있습니다.`
  : long ? 'GITHUB_TOKEN이 설정되지 않았습니다. Fine-grained 토큰(Actions: write)을 환경변수에 추가하세요.' : 'GITHUB_TOKEN이 설정되지 않았습니다.')

// GET /api/chatbot/bots?hub=delivery — 봇 목록 + 최근 체크 10건(오래된순) 병합
router.get('/bots', async (req, res) => {
  try {
    const hubId = await resolveHubId(hubKeyOf(req))
    if (!hubId) return res.status(404).json({ error: 'unknown hub' })

    const data = await repos.chatbots.listBots(hubId)

    // 하트비트용 최근 체크 이력 병합
    const byBot = new Map(data.map(b => [b.id, []]))
    if (data.length) {
      // 점검 이력 조회 실패는 이력 없이 보여 준다(이전 동작).
      const logs = await repos.checks.listRecent(data.map(b => b.id), Math.min(data.length * 10, 300)).catch(() => [])
      for (const row of logs) {
        const list = byBot.get(row.chatbot_id)
        if (list && list.length < 10) {
          list.push({ ok: row.ok, detail: row.detail, duration_ms: row.duration_ms, checked_at: row.checked_at })
        }
      }
    }
    res.json(data.map(b => ({ ...b, recent_checks: byBot.get(b.id).reverse() })))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// POST /api/chatbot/bots
router.post('/bots', async (req, res) => {
  const { name, url, scenario, input_selector, category } = req.body
  try {
    const hubId = await resolveHubId(hubKeyOf(req))
    if (!hubId) return res.status(404).json({ error: 'unknown hub' })
    const data = await repos.chatbots.createBot(hubId, { name, url, scenario: scenario ?? [], input_selector: input_selector || null, category: category?.trim() || null })
    res.status(201).json(data)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// PATCH /api/chatbot/bots/:id
router.patch('/bots/:id', async (req, res) => {
  const keys = Object.keys(req.body).filter(k => ALLOWED_BOT_PATCH_FIELDS.has(k))
  if (keys.length === 0) return res.status(400).json({ error: 'no valid fields' })
  const updateObj = Object.fromEntries(keys.map(k => [k, req.body[k]]))
  if ('category' in updateObj) updateObj.category = updateObj.category?.trim() || null
  try {
    const hubId = await resolveHubId(hubKeyOf(req))
    if (!hubId) return res.status(404).json({ error: 'unknown hub' })
    const bot = await repos.chatbots.updateBot(hubId, req.params.id, updateObj)
    if (!bot) return res.status(404).json({ error: 'not found' })
    res.json(bot)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// DELETE /api/chatbot/bots/:id
router.delete('/bots/:id', async (req, res) => {
  try {
    const hubId = await resolveHubId(hubKeyOf(req))
    if (!hubId) return res.status(404).json({ error: 'unknown hub' })
    await repos.chatbots.deleteBot(hubId, req.params.id)
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// POST /api/chatbot/run-check — 워크플로우 수동 트리거 (bot_id 있으면 해당 봇만)
router.post('/run-check', async (req, res) => {
  if (!checkRunner.available()) return res.status(503).json({ error: unavailable(true) })
  const { bot_id, category } = req.body ?? {}
  const hub = hubKeyOf(req)
  // bot_id(단건) 우선, 없으면 category(그룹). 항상 hub 전달.
  const inputs = bot_id ? { hub, bot_id } : category ? { hub, category } : { hub }
  try {
    const ghRes = await dispatchWorkflow(inputs)
    // 사내 실행기가 상한(돌고 있는 수동 점검)에 걸리면 429 그대로 — 외부(GitHub)는 429를 주지 않는다.
    if (ghRes.status === 429) return res.status(429).json({ error: '점검이 이미 돌고 있습니다. 끝난 뒤 다시 시도해 주세요.' })
    if (!ghRes.ok) {
      const text = await ghRes.text()
      return res.status(502).json({ error: `${dispatchLabel()} 실패 (${ghRes.status}): ${text.slice(0, 200)}` })
    }
    res.status(202).json({ triggered: true })
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

// GET /api/chatbot/dispatch?hub=delivery — pg_cron 정시 트리거. 해당 허브 전체 체크.
router.get('/dispatch', cronAuth, async (req, res) => {
  if (!checkRunner.available()) return res.status(503).json({ error: unavailable(false) })
  try {
    const ghRes = await dispatchWorkflow({ hub: hubKeyOf(req) })
    if (!ghRes.ok) {
      const text = await ghRes.text()
      return res.status(502).json({ error: `${dispatchLabel()} 실패 (${ghRes.status}): ${text.slice(0, 200)}` })
    }
    res.status(202).json({ triggered: true })
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

// 허브별 settings 행 조회
async function getSettingsRow(hubId) {
  // 설정 행은 허브를 만들 때 생긴다 — 없으면 이전처럼 오류(500).
  const row = await repos.chatbots.getSettings(hubId)
  if (!row) throw new Error(`hub_chatbot_settings 행이 없다(hub ${hubId})`)
  return row
}

// 설정 행 갱신(updated_at은 저장소가 채운다) — 없으면 이전처럼 오류(500).
async function updateSettingsRow(hubId, patch) {
  const row = await repos.chatbots.updateSettings(hubId, patch)
  if (!row) throw new Error(`hub_chatbot_settings 행이 없다(hub ${hubId})`)
  return row
}

// PATCH /api/chatbot/categories — 카테고리 이름 변경(봇까지 일괄 반영)
router.patch('/categories', async (req, res) => {
  const from = req.body?.from
  const to = (req.body?.to ?? '').trim()
  if (!from || !to) return res.status(400).json({ error: 'from/to required' })
  try {
    const hubId = await resolveHubId(hubKeyOf(req))
    if (!hubId) return res.status(404).json({ error: 'unknown hub' })
    await repos.chatbots.renameCategory(hubId, from, to)
    const s = await getSettingsRow(hubId)
    const seen = new Set()
    const categories = (s?.categories ?? [])
      .map(c => (c === from ? to : c)).map(c => String(c).trim())
      .filter(c => c && !seen.has(c) && seen.add(c))
    res.json(await updateSettingsRow(hubId, { categories }))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// DELETE /api/chatbot/categories — 카테고리 삭제(해당 봇은 미분류로 이동)
router.delete('/categories', async (req, res) => {
  const name = req.body?.name
  if (!name) return res.status(400).json({ error: 'name required' })
  try {
    const hubId = await resolveHubId(hubKeyOf(req))
    if (!hubId) return res.status(404).json({ error: 'unknown hub' })
    await repos.chatbots.renameCategory(hubId, name, null)
    const s = await getSettingsRow(hubId)
    const categories = (s?.categories ?? []).filter(c => c !== name)
    res.json(await updateSettingsRow(hubId, { categories }))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// GET /api/chatbot/settings?hub=delivery
router.get('/settings', async (req, res) => {
  try {
    const hubId = await resolveHubId(hubKeyOf(req))
    if (!hubId) return res.status(404).json({ error: 'unknown hub' })
    const data = await getSettingsRow(hubId)
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// PUT /api/chatbot/settings — recipients / categories 부분 갱신 (제공된 것만 변경)
router.put('/settings', async (req, res) => {
  const { recipients, categories } = req.body
  const patch = {}
  if (recipients !== undefined) patch.recipients = recipients ?? []
  if (categories !== undefined) {
    const seen = new Set()
    patch.categories = (Array.isArray(categories) ? categories : [])
      .map(c => String(c).trim())
      .filter(c => c && !seen.has(c) && seen.add(c)) // 트림·빈값·중복 제거, 순서 유지
  }
  try {
    const hubId = await resolveHubId(hubKeyOf(req))
    if (!hubId) return res.status(404).json({ error: 'unknown hub' })
    res.json(await updateSettingsRow(hubId, patch))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

export default router
