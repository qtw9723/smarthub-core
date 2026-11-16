// src/demo/demoBackend.js — 데모 빌드(VITE_DEMO=true) 전용 가짜 백엔드.
//
// 실제 화면(백오피스·허브·챗봇 점검 모듈)을 그대로 띄우되, /api/* 호출만 브라우저 안에서 응답한다.
// 상태는 메모리에만 있다(새로고침하면 처음으로). 실운영이 아니며 외부로 나가는 요청은 없다.
//
// 비밀번호 단계는 없다 — 설치 시 마스터 키 쿠키를 심어 바로 들어간다.

const MIN = 60 * 1000
const ago = (m) => new Date(Date.now() - m * MIN).toISOString()
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const err = (status, error, extra = {}) => json({ error, ...extra }, status)

import { handleModule, moduleEvents } from './mockModules.js'

const MODULES = [{ key: 'chatbot-monitoring' }, { key: 'grafana-reports' }, { key: 'mailer' }, { key: 'sheet-to-schema' }, { key: 'doc-to-api' }]
// 모듈별 기본 보안 등급(shared/securityPolicy.js와 같은 값)
const SECURITY_DEFAULT = { 'chatbot-monitoring': 'L2', 'grafana-reports': 'L2', mailer: 'L3', 'sheet-to-schema': 'L0', 'doc-to-api': 'L2' }
const LEVELS = ['L0', 'L1', 'L2', 'L3']

let seq = 100
const uid = (p) => `${p}-${++seq}`

// ── 시드 ───────────────────────────────────────────────────────────────
const hubs = [
  { id: 'hub-1', key: 'delivery', name: '배달팀', enabled: true, password: null, security_ack_level: 'L3', created_at: ago(60 * 24 * 40) },
  { id: 'hub-2', key: 'support', name: '고객지원팀', enabled: true, password: null, security_ack_level: 'L3', created_at: ago(60 * 24 * 30) },
  { id: 'hub-3', key: 'finance', name: '재무팀', enabled: true, password: null, security_ack_level: 'L2', created_at: ago(60 * 24 * 12) },
]
// hub_features 매트릭스 — 허브마다 켠 모듈이 다르다.
const ENABLED = {
  'hub-1': ['chatbot-monitoring', 'grafana-reports', 'mailer', 'sheet-to-schema', 'doc-to-api'],
  'hub-2': ['chatbot-monitoring', 'mailer'],
  'hub-3': ['sheet-to-schema', 'doc-to-api'],
}
const features = Object.entries(ENABLED).flatMap(([hub_id, on]) =>
  MODULES.map((m, i) => ({ hub_id, feature_key: m.key, enabled: on.includes(m.key), config: {}, sort_order: i })))
const security = {} // module_key -> { level, reason, updated_at }

const SCEN = (hello, ok) => [{ type: 'say', say: hello, expect: ok }, { type: 'say', say: '운영 시간 알려줘', expect: '평일' }]
const bots = []
function seedBot(hub_id, name, category, url, okPattern) {
  const id = uid('bot')
  bots.push({
    id, hub_id, name, url, category, enabled: true, sort_order: bots.length, input_selector: null,
    scenario: SCEN('안녕하세요', '도움'), checks: okPattern.map((ok, i) => ({
      ok, detail: ok ? null : 'goto_failed: Timeout 30000ms', duration_ms: ok ? 8000 + i * 350 : 60000,
      checked_at: ago((okPattern.length - i) * 60 * 6),
    })),
  })
}
seedBot('hub-1', '주문 안내 봇', '주문', 'https://bot.example.com/order', [true, true, true, true, true, true, true, true])
seedBot('hub-1', '환불 안내 봇', '주문', 'https://bot.example.com/refund', [true, true, false, true, true, true, true, true])
seedBot('hub-1', '쿠폰 문의 봇', '혜택', 'https://bot.example.com/coupon', [true, true, true, true, true, true, false, false])
seedBot('hub-2', '일반 문의 봇', '문의', 'https://bot.example.com/faq', [true, true, true, true, true, true, true, true])
seedBot('hub-2', '영어 문의 봇', '문의', 'https://bot.example.com/en', [true, true, true, false, true, true, true, true])
seedBot('hub-3', '정산 안내 봇', '정산', 'https://bot.example.com/settle', [true, true, true, true])

const settings = {
  'hub-1': { recipients: ['ops@example.com'], categories: ['주문', '혜택'] },
  'hub-2': { recipients: [], categories: ['문의'] },
  'hub-3': { recipients: [], categories: ['정산'] },
}

// ── 응답 모양 ──────────────────────────────────────────────────────────
const pubHub = (h) => ({ id: h.id, key: h.key, name: h.name, enabled: h.enabled, created_at: h.created_at,
  has_password: !!h.password, security_ack_level: h.security_ack_level })
const botOut = (b) => {
  const { checks, hub_id: _h, ...rest } = b
  return { ...rest, hub_id: b.hub_id, recent_checks: checks.slice(-10) }
}
const lastCheck = (b) => b.checks[b.checks.length - 1] ?? null
const hubByKey = (k) => hubs.find((h) => h.key === k)
const resolveHub = (k) => hubs.find((h) => h.key === k || h.id === k)
const securityRow = (key) => ({
  key, defaultLevel: SECURITY_DEFAULT[key], level: security[key]?.level ?? SECURITY_DEFAULT[key],
  reason: security[key]?.reason ?? null, updated_at: security[key]?.updated_at ?? null,
})

function hubAccess(req, hub) {
  if (!hub.password) return true
  if (req.headers.get('x-app-password')) return true // 마스터 키
  let pw = req.headers.get('x-hub-password') || ''
  try { pw = decodeURIComponent(pw) } catch { /* 그대로 */ }
  return pw === hub.password
}

// ── 점검 실행(가짜) — 눌렀다가 잠시 뒤 결과가 쌓인다 ────────────────────
function simulateRun(targets) {
  setTimeout(() => {
    for (const b of targets) {
      const ok = Math.random() > 0.2
      b.checks.push({ ok, detail: ok ? null : '키워드 "도움" 미노출', duration_ms: 9000 + Math.round(Math.random() * 3000), checked_at: new Date().toISOString() })
    }
  }, 2500)
}

// ── 라우터 ────────────────────────────────────────────────────────────
async function handle(req, url) {
  const path = url.pathname
  const method = req.method
  const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ? await req.json().catch(() => ({})) : {}

  // 공개: /api/hubs/:key , /api/hubs/:key/features
  let m = path.match(/^\/api\/hubs\/([^/]+)(\/features)?$/)
  if (m) {
    const hub = hubByKey(decodeURIComponent(m[1]))
    if (!hub || !hub.enabled) return err(404, 'unknown hub')
    if (!m[2]) return json({ key: hub.key, name: hub.name, requiresPassword: !!hub.password })
    if (!hubAccess(req, hub)) return err(401, 'HUB_PASSWORD_REQUIRED', { hub: { key: hub.key, name: hub.name } })
    return json({
      hub: { key: hub.key, name: hub.name },
      features: features.filter((f) => f.hub_id === hub.id && f.enabled)
        .map((f) => ({ feature_key: f.feature_key, enabled: f.enabled, sort_order: f.sort_order })),
    })
  }

  // mailer · grafana-reports · doc-to-api (mockModules.js)
  m = path.match(/^\/api\/modules\/(?:mailer|grafana-reports|doc-to-api)(\/.*)?$/)
  if (m) {
    const hub = hubByKey(url.searchParams.get('hub') || 'delivery')
    if (!hub) return err(404, 'unknown hub')
    if (!hubAccess(req, hub)) return err(401, 'HUB_PASSWORD_REQUIRED', { hub: { key: hub.key, name: hub.name } })
    return handleModule(path, method, body, hub, url)
  }

  // 챗봇 점검 모듈
  m = path.match(/^\/api\/(?:chatbot|modules\/chatbot-monitoring)(\/.*)?$/)
  if (m) {
    const hub = hubByKey(url.searchParams.get('hub') || 'delivery')
    if (!hub) return err(404, 'unknown hub')
    if (!hubAccess(req, hub)) return err(401, 'HUB_PASSWORD_REQUIRED', { hub: { key: hub.key, name: hub.name } })
    const sub = m[1] || ''
    const hubBots = bots.filter((b) => b.hub_id === hub.id)
    if (sub === '/bots' && method === 'GET') return json(hubBots.map(botOut))
    if (sub === '/bots' && method === 'POST') {
      const b = { id: uid('bot'), hub_id: hub.id, name: body.name, url: body.url, scenario: body.scenario ?? [],
        input_selector: body.input_selector || null, category: body.category?.trim() || null, enabled: true,
        sort_order: hubBots.length, checks: [] }
      bots.push(b)
      return json(botOut(b), 201)
    }
    const bm = sub.match(/^\/bots\/([^/]+)$/)
    if (bm) {
      const b = bots.find((x) => x.id === bm[1] && x.hub_id === hub.id)
      if (!b) return err(404, 'not found')
      if (method === 'PATCH') { Object.assign(b, body); return json(botOut(b)) }
      if (method === 'DELETE') { bots.splice(bots.indexOf(b), 1); return json({ success: true }) }
    }
    if (sub === '/run-check' && method === 'POST') {
      const targets = body.bot_id ? hubBots.filter((b) => b.id === body.bot_id)
        : body.category ? hubBots.filter((b) => b.category === body.category) : hubBots
      simulateRun(targets)
      return json({ triggered: true }, 202)
    }
    if (sub === '/settings') {
      const s = (settings[hub.id] ??= { recipients: [], categories: [] })
      if (method === 'GET') return json({ hub_id: hub.id, ...s })
      if (method === 'PUT') {
        if (body.recipients !== undefined) s.recipients = body.recipients ?? []
        if (body.categories !== undefined) s.categories = [...new Set((body.categories ?? []).map((c) => String(c).trim()).filter(Boolean))]
        return json({ hub_id: hub.id, ...s })
      }
    }
    if (sub === '/categories') {
      const s = (settings[hub.id] ??= { recipients: [], categories: [] })
      if (method === 'PATCH') {
        s.categories = s.categories.map((c) => (c === body.from ? body.to : c))
        hubBots.forEach((b) => { if (b.category === body.from) b.category = body.to })
        return json({ hub_id: hub.id, ...s })
      }
      if (method === 'DELETE') {
        s.categories = s.categories.filter((c) => c !== body.name)
        hubBots.forEach((b) => { if (b.category === body.name) b.category = null })
        return json({ hub_id: hub.id, ...s })
      }
    }
    return err(404, 'not found')
  }

  // 백오피스: /api/admin/* — 마스터 키는 아무 값이나(비어 있지만 않으면)
  if (path.startsWith('/api/admin')) {
    if (!req.headers.get('x-app-password')) return err(401, 'unauthorized')
    const p = path.replace('/api/admin', '')
    if (p === '/modules') return json(MODULES)
    if (p === '/hubs' && method === 'GET') return json(hubs.map(pubHub))
    if (p === '/hubs' && method === 'POST') {
      const key = (body.key ?? '').trim().toLowerCase()
      if (!key || !body.name) return err(400, 'key/name required')
      if (hubByKey(key)) return err(409, 'key already exists')
      if (!body.password?.trim() && body.public_ack !== true) return err(400, 'PUBLIC_ACK_REQUIRED', { message: '비밀번호를 설정하거나, 이 허브를 공개로 만든다고 명시해야 합니다(public_ack).' })
      const h = { id: uid('hub'), key, name: body.name, enabled: true, password: body.password?.trim() || null, security_ack_level: null, created_at: new Date().toISOString() }
      hubs.push(h)
      return json(pubHub(h), 201)
    }
    let hm = p.match(/^\/hubs\/([^/]+)$/)
    if (hm) {
      const h = resolveHub(hm[1])
      if (!h) return err(404, 'not found')
      if (method === 'PATCH') { if (body.name) h.name = body.name; if (body.enabled !== undefined) h.enabled = !!body.enabled; return json(pubHub(h)) }
      if (method === 'DELETE') { hubs.splice(hubs.indexOf(h), 1); return json({ success: true }) }
    }
    hm = p.match(/^\/hubs\/([^/]+)\/password$/)
    if (hm && method === 'PUT') {
      const h = resolveHub(hm[1]); if (!h) return err(404, 'not found')
      h.password = body.password?.trim() || null
      return json(pubHub(h))
    }
    hm = p.match(/^\/hubs\/([^/]+)\/security-ack$/)
    if (hm && method === 'PUT') {
      const h = resolveHub(hm[1]); if (!h) return err(404, 'not found')
      h.security_ack_level = body.level ?? null
      return json(pubHub(h))
    }
    hm = p.match(/^\/hubs\/([^/]+)\/features(?:\/([^/]+))?$/)
    if (hm) {
      const h = resolveHub(hm[1]); if (!h) return err(404, 'unknown hub')
      if (!hm[2] && method === 'GET') {
        return json({ hub: { id: h.id, key: h.key, name: h.name },
          features: features.filter((f) => f.hub_id === h.id).map((f) => ({ feature_key: f.feature_key, enabled: f.enabled, config: f.config, sort_order: f.sort_order })) })
      }
      if (hm[2] && method === 'PUT') {
        if (!MODULES.some((x) => x.key === hm[2])) return err(400, 'unknown module')
        let f = features.find((x) => x.hub_id === h.id && x.feature_key === hm[2])
        if (!f) { f = { hub_id: h.id, feature_key: hm[2], enabled: false, config: {}, sort_order: 0 }; features.push(f) }
        if (body.enabled !== undefined) f.enabled = !!body.enabled
        if (body.config !== undefined) f.config = body.config ?? {}
        if (body.sort_order !== undefined) f.sort_order = body.sort_order
        return json(f)
      }
    }
    if (p === '/overview') {
      return json(hubs.map((h) => ({
        hub: { id: h.id, key: h.key, name: h.name, enabled: h.enabled, has_password: !!h.password, security_ack_level: h.security_ack_level },
        features: features.filter((f) => f.hub_id === h.id && f.enabled).map((f) => {
          if (f.feature_key !== 'chatbot-monitoring') return { key: f.feature_key, summary: {} }
          const hb = bots.filter((b) => b.hub_id === h.id)
          const items = hb.map((b) => ({ id: b.id, name: b.name, enabled: b.enabled, category: b.category, last_check: lastCheck(b) ? { ok: lastCheck(b).ok, checked_at: lastCheck(b).checked_at } : null }))
          return { key: f.feature_key, summary: { bot_count: items.length, failing_count: items.filter((i) => i.last_check && !i.last_check.ok).length }, items }
        }),
      })))
    }
    if (p === '/activity') {
      const events = []
      for (const b of bots) {
        const h = hubs.find((x) => x.id === b.hub_id)
        for (const c of b.checks.slice(-3)) {
          events.push({ type: 'chatbot', severity: c.ok ? 'good' : 'crit', hubKey: h?.key ?? null, hubName: h?.name ?? null,
            title: c.ok ? `${b.name} 점검 정상` : `${b.name} 점검 실패`, detail: c.ok ? null : String(c.detail ?? '').slice(0, 80), at: c.checked_at })
        }
      }
      events.push(...moduleEvents(hubs, (hid, key) => features.some((f) => f.hub_id === hid && f.feature_key === key && f.enabled)))
      events.sort((a, b) => new Date(b.at) - new Date(a.at))
      const LABELS = { 'chatbot-monitoring': '챗봇 점검', 'grafana-reports': 'Grafana 리포트', mailer: '메일 발송' }
      const extra = features.filter((f) => f.enabled && (f.feature_key === 'grafana-reports' || f.feature_key === 'mailer')).map((f) => {
        const h = hubs.find((x) => x.id === f.hub_id)
        return { hubKey: h.key, hubName: h.name, module: f.feature_key, label: LABELS[f.feature_key], lastRun: ago(f.feature_key === 'mailer' ? 95 : 180), ok: true }
      })
      const automations = features.filter((f) => f.enabled && f.feature_key === 'chatbot-monitoring').map((f) => {
        const h = hubs.find((x) => x.id === f.hub_id)
        const latest = bots.filter((b) => b.hub_id === h.id).flatMap((b) => b.checks).sort((a, b) => new Date(b.checked_at) - new Date(a.checked_at))
        const batch = latest.slice(0, bots.filter((b) => b.hub_id === h.id).length || latest.length)
        return { hubKey: h.key, hubName: h.name, module: f.feature_key, label: '챗봇 점검', lastRun: batch[0]?.checked_at ?? null, ok: batch.length ? batch.every((c) => c.ok) : null }
      })
      return json({ events: events.slice(0, 15), automations: [...automations, ...extra] })
    }
    if (p === '/security' && method === 'GET') return json({ modules: MODULES.map((x) => securityRow(x.key)) })
    const sm = p.match(/^\/security\/([^/]+)$/)
    if (sm && method === 'PUT') {
      const key = sm[1]
      if (!MODULES.some((x) => x.key === key)) return err(400, 'unknown module')
      if (!LEVELS.includes(body.level)) return err(400, 'invalid level')
      const reason = (body.reason ?? '').trim()
      if (LEVELS.indexOf(body.level) < LEVELS.indexOf(SECURITY_DEFAULT[key]) && !reason) {
        return err(400, 'REASON_REQUIRED', { message: '기본 레벨보다 낮추려면 사유가 필요합니다.' })
      }
      if (body.level === SECURITY_DEFAULT[key]) delete security[key]
      else security[key] = { level: body.level, reason: reason || null, updated_at: new Date().toISOString() }
      return json(securityRow(key))
    }
    if (p === '/master-key' && method === 'PUT') return json({ ok: true })
  }

  return err(404, 'not found (demo)')
}

export function installDemo() {
  document.cookie = 'smarthub-password=demo; path=/' // 로그인 화면을 건너뛴다(데모)
  const realFetch = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const req = new Request(input, init)
    const url = new URL(req.url, window.location.origin)
    if (!url.pathname.startsWith('/api/')) return realFetch(input, init)
    await new Promise((r) => setTimeout(r, 80)) // 네트워크처럼 보이게 아주 짧게
    return handle(req, url)
  }
  const bar = document.createElement('div')
  bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:9999;background:#1d4ed8;color:#fff;font:12px/1.4 system-ui;padding:6px 12px;text-align:center'
  bar.innerHTML = '실운영 아님 · 데모 — 실제 화면에 가짜 백엔드를 붙인 것입니다(새로고침하면 초기화). <a style="color:#fff;text-decoration:underline" href="https://github.com/qtw9723/smarthub-core" target="_blank" rel="noreferrer">소스</a>'
  document.body.appendChild(bar)
}
