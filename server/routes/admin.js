// server/routes/admin.js — 중앙 백오피스: 허브 레지스트리 + hub_features 매트릭스 + 모듈 순회 관망
import { Router } from 'express'
import { getModules, getModule } from '../modules/index.js'
import { hashPassword } from '../lib/hubPassword.js'
import { isMasterKey, setMasterKey, MIN_LENGTH, MAX_LENGTH } from '../lib/masterKey.js'
import { isBlocked, noteFailure, sendBlocked } from '../lib/authThrottle.js'
import { LEVELS, levelRank, defaultLevelOf } from '../../shared/securityPolicy.js'
import { repos, UniqueViolationError } from '../data/index.js'
import { isUuid } from '../lib/ids.js'

const router = Router()

// 허브 행을 응답용으로 정리한다. **password_hash는 어떤 응답에도 나가지 않는다** —
// 대신 설정 여부만 has_password 불리언으로 알려준다(백오피스가 "설정됨/공개"를 표시).
// hubs를 select('*')로 읽는 자리는 전부 이걸 거친다.
function sanitizeHub(hub) {
  if (!hub) return hub
  const { password_hash, ...rest } = hub
  return { ...rest, has_password: !!password_hash }
}

// 마스터 키 — 백오피스에서 바꾼 키(DB) 또는 서버 설정값 APP_PASSWORD(server/lib/masterKey.js).
// 키를 넣은 요청만 시도로 센다. 막힌 클라이언트는 확인 전에 429(lib/authThrottle.js).
async function auth(req, res, next) {
  const given = req.headers['x-app-password']
  if (given) {
    const { blocked, retryAfterSec } = await isBlocked(req)
    if (blocked) return sendBlocked(res, retryAfterSec)
  }
  if (!(await isMasterKey(given))) {
    if (given) await noteFailure(req)
    return res.status(401).json({ error: 'unauthorized' })
  }
  next()
}

// :id(허브 uuid) 형식 검사 — auth 뒤에 둔다. 형식이 틀린 id는 있을 수 없는 허브이므로 없는 uuid와 같게 404.
// 검사 없이 DB로 가면 Postgres 22P02가 500 + 원문(`invalid input syntax for type uuid`)으로 샜다(2026-11-09·10 QA F1).
function validHubId(req, res, next) {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'not found' })
  next()
}

// idOrKey(UUID 또는 hub key)로 허브 1건 조회
async function resolveHub(idOrKey) {
  // 조회 오류는 '없음'과 같게 본다(이전 동작 — 404).
  return repos.hubs.getHubByIdOrKey(idOrKey).catch(() => null)
}

// PUT /api/admin/master-key — 마스터 키 바꾸기. 지금 키(헤더)로 들어온 사람만. 바꾸면 그때부터 서버 설정값(APP_PASSWORD)은
// 통하지 않는다. 잊었을 때 되돌리는 법: docs/internal-edition.md "마스터 키".
router.put('/master-key', auth, async (req, res) => {
  const next = req.body?.next
  if (typeof next !== 'string' || next.length < MIN_LENGTH || next.length > MAX_LENGTH) {
    return res.status(400).json({ error: `새 마스터 키는 ${MIN_LENGTH}~${MAX_LENGTH}자여야 합니다` })
  }
  if (next === req.headers['x-app-password']) return res.status(400).json({ error: '지금 키와 같습니다' })
  try {
    await setMasterKey(next)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// GET /api/admin/modules — 등록된 모듈 키 목록 (백오피스 토글용)
router.get('/modules', auth, (_req, res) => {
  res.json(getModules().map(m => ({ key: m.key })))
})

// GET /api/admin/hubs — 허브 목록
router.get('/hubs', auth, async (_req, res) => {
  try {
    res.json((await repos.hubs.listHubs()).map(sanitizeHub))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// POST /api/admin/hubs — 허브 생성 + settings 행 자동 생성
router.post('/hubs', auth, async (req, res) => {
  const key = (req.body?.key ?? '').trim().toLowerCase()
  const name = (req.body?.name ?? '').trim()
  if (!key || !name) return res.status(400).json({ error: 'key/name required' })
  if (!/^[a-z0-9-]+$/.test(key)) return res.status(400).json({ error: 'key must be lowercase alphanumeric/hyphen' })

  // 기본 잠금: 비밀번호 없이 만들려면 **공개로 만든다고 명시**해야 한다.
  // 공개 허브 자체를 금지하지는 않는다(사내 전용 허브도 있다) — 잊어서 공개가 되는 것만 막는다.
  // UI 체크박스만으로 두지 않고 API에서 막는 이유: 다른 클라이언트·스크립트가 조용히
  // 공개 허브를 만드는 길을 남기면 규칙이 아니라 권고가 된다.
  const plain = typeof req.body?.password === 'string' ? req.body.password.trim() : ''
  if (!plain && req.body?.public_ack !== true) {
    return res.status(400).json({
      error: 'PUBLIC_ACK_REQUIRED',
      message: '비밀번호를 설정하거나, 이 허브를 공개로 만든다고 명시해야 합니다(public_ack).',
    })
  }

  const row = { key, name }
  if (plain) row.password_hash = hashPassword(plain)

  try {
    let data
    try {
      data = await repos.hubs.createHub(row)
    } catch (error) {
      if (error instanceof UniqueViolationError) return res.status(409).json({ error: 'hub key already exists' })
      throw error
    }
    // 설정 행 만들기 실패는 허브 생성을 막지 않는다(이전 동작).
    await repos.chatbots.ensureSettings(data.id).catch(() => {})
    res.status(201).json(sanitizeHub(data))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// PATCH /api/admin/hubs/:id — name/enabled/sort_order 갱신
const ALLOWED_HUB_FIELDS = new Set(['name', 'enabled', 'sort_order'])
router.patch('/hubs/:id', auth, validHubId, async (req, res) => {
  const keys = Object.keys(req.body).filter(k => ALLOWED_HUB_FIELDS.has(k))
  if (keys.length === 0) return res.status(400).json({ error: 'no valid fields' })
  const updateObj = Object.fromEntries(keys.map(k => [k, req.body[k]]))
  try {
    const hub = await repos.hubs.updateHub(req.params.id, updateObj)
    if (!hub) return res.status(404).json({ error: 'not found' })
    res.json(sanitizeHub(hub))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// PUT /api/admin/hubs/:id/password — 허브 비밀번호 설정/해제
//
// 빈 문자열·null이면 해제(NULL) = 그 허브는 공개가 된다. 평문은 저장하지 않는다(scrypt 해시).
// 일반 PATCH가 아니라 별도 경로인 이유: 해싱이 필요하고, ALLOWED_HUB_FIELDS 화이트리스트에
// password_hash를 넣으면 클라이언트가 해시를 직접 밀어넣을 수 있게 된다.
router.put('/hubs/:id/password', auth, validHubId, async (req, res) => {
  const raw = req.body?.password
  if (raw !== null && raw !== undefined && typeof raw !== 'string') {
    return res.status(400).json({ error: 'password must be a string or null' })
  }
  const plain = (raw ?? '').trim()
  try {
    const password_hash = plain === '' ? null : hashPassword(plain)
    const hub = await repos.hubs.setPasswordHash(req.params.id, password_hash)
    if (!hub) return res.status(404).json({ error: 'not found' })
    // 비밀번호를 설정하면 "확인된 예외"(공개로 두기로 한 확인)는 의미가 없어지므로 지운다 — 다시 해제하면 새로 경고.
    // 비밀번호 저장과 **따로** 하고 실패해도 넘어간다: 마이그레이션 전(열 없음)에도 비밀번호 설정은 돼야 한다 —
    // 백오피스 경고가 안내하는 해결책이 바로 이것이다.
    if (password_hash) {
      try {
        await repos.hubs.setSecurityAck(req.params.id, null)
      } catch (ackErr) {
        console.warn('[admin] security_ack_level 초기화 실패(마이그레이션 전일 수 있음):', ackErr?.message)
      }
    }
    res.json(sanitizeHub(hub))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// PUT /api/admin/hubs/:id/security-ack — 정책 위반을 "확인함"으로 둔다(확인된 예외). body { level: 'L0'..'L3' | null }
// level = 확인 시점의 요구 레벨. 판정은 백오피스가 한다: 현재 요구 레벨이 이보다 높아지면 예외가 풀린다. null = 예외 해제.
// 서버는 level을 검증만 하고 실제 요구 레벨과 대조하지 않는다(마스터 키 보유자 = 신뢰, 화면은 항상 판정된 요구 레벨을 보낸다).
router.put('/hubs/:id/security-ack', auth, validHubId, async (req, res) => {
  const level = req.body?.level ?? null
  if (level !== null && !LEVELS.includes(level)) return res.status(400).json({ error: 'invalid level' })
  try {
    const hub = await repos.hubs.setSecurityAck(req.params.id, level)
    if (!hub) return res.status(404).json({ error: 'not found' })
    res.json(sanitizeHub(hub))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── 모듈 보안 레벨 ──
// 기본값은 shared/securityPolicy.js, 관리자가 조정한 값만 hub_module_security에 행으로 둔다.
// 레벨은 모듈 단위이고 마스터 키로만 바뀐다 — 허브 비밀번호(허브 사용자)로는 바꿀 수 없다.
const securityRow = (key, row) => ({
  key,
  defaultLevel: defaultLevelOf(key),
  level: row?.level ?? defaultLevelOf(key),
  reason: row?.reason ?? null,
  updated_at: row?.updated_at ?? null,
})

// GET /api/admin/security — 모듈별 { key, defaultLevel, level, reason, updated_at } (서버 레지스트리 순서)
router.get('/security', auth, async (_req, res) => {
  try {
    const byKey = new Map((await repos.security.list()).map(r => [r.module_key, r]))
    res.json({ modules: getModules().map(m => securityRow(m.key, byKey.get(m.key))) })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// PUT /api/admin/security/:moduleKey — body { level, reason? }. 기본보다 낮추면 사유 필수.
// 기본값과 같은 레벨이면 행을 지운다(기본값을 따르는 상태로 되돌림).
router.put('/security/:moduleKey', auth, async (req, res) => {
  const key = req.params.moduleKey
  if (!getModule(key)) return res.status(400).json({ error: 'unknown module' })
  const level = req.body?.level
  if (!LEVELS.includes(level)) return res.status(400).json({ error: 'invalid level' })
  const raw = req.body?.reason
  if (raw != null && typeof raw !== 'string') return res.status(400).json({ error: 'reason must be a string' })
  const reason = (raw ?? '').trim()
  if (reason.length > 200) return res.status(400).json({ error: 'reason too long' })
  const def = defaultLevelOf(key)
  if (levelRank(level) < levelRank(def) && !reason) {
    return res.status(400).json({ error: 'REASON_REQUIRED', message: '기본 레벨보다 낮추려면 사유가 필요합니다.' })
  }
  try {
    if (level === def) {
      await repos.security.remove(key)
      return res.json(securityRow(key, null))
    }
    const row = { module_key: key, level, reason: reason || null, updated_at: new Date().toISOString() }
    await repos.security.upsert(row)
    res.json(securityRow(key, row))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// DELETE /api/admin/hubs/:id — 허브 삭제 (hub_features 등은 DB FK ON DELETE CASCADE로 함께 정리)
router.delete('/hubs/:id', auth, validHubId, async (req, res) => {
  try {
    if (!(await repos.hubs.deleteHub(req.params.id))) return res.status(404).json({ error: 'not found' })
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// GET /api/admin/hubs/:idOrKey/features — 허브의 모듈 매트릭스 (enabled 포함 전체)
router.get('/hubs/:idOrKey/features', auth, async (req, res) => {
  try {
    const hub = await resolveHub(req.params.idOrKey)
    if (!hub) return res.status(404).json({ error: 'unknown hub' })
    const features = await repos.features.listAdmin(hub.id)
    res.json({ hub: { id: hub.id, key: hub.key, name: hub.name }, features })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// PUT /api/admin/hubs/:idOrKey/features/:key — 모듈 켜기/끄기·config·순서 (upsert)
router.put('/hubs/:idOrKey/features/:key', auth, async (req, res) => {
  if (!getModule(req.params.key)) return res.status(400).json({ error: 'unknown module' })
  try {
    const hub = await resolveHub(req.params.idOrKey)
    if (!hub) return res.status(404).json({ error: 'unknown hub' })
    const patch = {}
    if (req.body?.enabled !== undefined) patch.enabled = !!req.body.enabled
    if (req.body?.config !== undefined) patch.config = req.body.config ?? {}
    if (req.body?.sort_order !== undefined) patch.sort_order = req.body.sort_order
    res.json(await repos.features.upsert(hub.id, req.params.key, patch))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// GET /api/admin/overview — 모듈 레지스트리 순회로 허브 × (enabled 모듈) 요약 집계
router.get('/overview', auth, async (_req, res) => {
  try {
    // 서로 기다릴 필요 없는 조회는 동시에 보낸다(2026-11-12) — 외부판은 조회마다 Supabase REST 왕복이라
    // 하나씩 기다리면 허브 × 모듈 수만큼 지연이 쌓였다. 응답 순서는 허브 목록·레지스트리 순서 그대로다.
    const [hubs, feats] = await Promise.all([repos.hubs.listHubs(), repos.features.listAllFlags()])
    const enabledByHub = new Map()
    for (const f of feats ?? []) {
      if (!f.enabled) continue
      if (!enabledByHub.has(f.hub_id)) enabledByHub.set(f.hub_id, new Set())
      enabledByHub.get(f.hub_id).add(f.feature_key)
    }

    const out = await Promise.all(hubs.map(async (h) => {
      const enabled = enabledByHub.get(h.id) ?? new Set()
      const features = await Promise.all(getModules()
        .filter((m) => enabled.has(m.key))
        .map(async (m) => ({ key: m.key, ...(m.overview ? await m.overview(h.id) : { summary: {} }) })))
      // has_password: 백오피스 카드가 잠금 상태를 표시한다. 해시 자체는 내보내지 않는다.
      return {
        // security_ack_level: 확인된 예외(정책 위반을 알고 공개로 둠) — 판정은 백오피스(src/lib/securityPolicy.js).
        hub: {
          id: h.id, key: h.key, name: h.name, enabled: h.enabled, has_password: !!h.password_hash,
          security_ack_level: h.security_ack_level ?? null,
        },
        features,
      }
    }))
    res.json(out)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 모듈별 자동화 표시명 (스케줄이 있는 모듈만 automations에 노출)
const AUTOMATION_LABELS = {
  'chatbot-monitoring': '챗봇 점검',
}

// GET /api/admin/activity — 최근 이벤트 피드 + 허브별 자동화 상태(읽기 전용, 소스별 방어적 조회)
router.get('/activity', auth, async (_req, res) => {
  try {
    // 4개 소스는 서로 기다릴 필요가 없어 동시에 보낸다(2026-11-12, overview와 같은 이유). 소스별 방어는 그대로 —
    // 허브 목록 실패만 전체 500이고, 나머지는 실패하면 그 소스만 비운다.
    const soft = (p) => p.catch(() => [])
    const [hubs, feats, bots, checkLogs] = await Promise.all([
      repos.hubs.listHubIdNames(),
      soft(repos.features.listAllFlags()), // 실패 시 automations만 비움
      soft(repos.chatbots.listAllBotNames()), // 실패 시 chatbot 이벤트/자동화만 스킵
      soft(repos.checks.listRecentEvents(200)),
    ])
    const hubsById = new Map(hubs.map(h => [h.id, h]))
    const botsById = new Map(bots.map(b => [b.id, b]))
    const botIdsByHub = new Map()
    for (const b of bots) {
      if (!botIdsByHub.has(b.hub_id)) botIdsByHub.set(b.hub_id, [])
      botIdsByHub.get(b.hub_id).push(b.id)
    }

    // ---- events: 소스별로 만든 뒤 병합 → at 내림차순 → 15건 ----
    const events = []
    for (const r of checkLogs.slice(0, 10)) {
      const hub = hubsById.get(r.hub_id)
      const botName = botsById.get(r.chatbot_id)?.name ?? '봇'
      events.push({
        type: 'chatbot',
        severity: r.ok ? 'good' : 'crit',
        hubKey: hub?.key ?? null,
        hubName: hub?.name ?? null,
        title: r.ok ? `${botName} 점검 정상` : `${botName} 점검 실패`,
        detail: r.ok ? null : String(r.detail ?? '').slice(0, 80),
        at: r.checked_at,
      })
    }
    events.sort((a, b) => new Date(b.at) - new Date(a.at))
    const topEvents = events.slice(0, 15)

    // ---- automations: hub_features enabled × (스케줄 있는 모듈) ----
    const enabledByHub = new Map()
    for (const f of feats) {
      if (!f.enabled) continue
      if (!enabledByHub.has(f.hub_id)) enabledByHub.set(f.hub_id, new Set())
      enabledByHub.get(f.hub_id).add(f.feature_key)
    }

    const automations = []
    for (const [hubId, modules] of enabledByHub) {
      const hub = hubsById.get(hubId)
      if (!hub) continue
      for (const mod of modules) {
        const label = AUTOMATION_LABELS[mod]
        if (!label) continue // 스케줄이 없는 모듈은 automations에 노출하지 않음
        let lastRun = null
        let ok = null
        if (mod === 'chatbot-monitoring') {
          const botIds = botIdsByHub.get(hubId) ?? []
          const hubLogs = checkLogs
            .filter(r => r.hub_id === hubId)
            .slice(0, botIds.length || checkLogs.length)
          if (hubLogs.length) {
            lastRun = hubLogs[0].checked_at
            ok = hubLogs.every(r => r.ok)
          }
        }
        automations.push({ hubKey: hub.key, hubName: hub.name, module: mod, label, lastRun, ok })
      }
    }

    res.json({ events: topEvents, automations })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

export default router
