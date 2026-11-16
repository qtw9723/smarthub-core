// server/lib/teamHost.js — 팀 주소: <허브키>.<TEAM_HOST_SUFFIX>(예: cs.smarthub.example.com)로 들어오면 그 허브만 쓰게 한다.
//
// 2026-11-10 사용자 결정 — 팀원에게는 자기 팀 허브만 주고 백오피스는 막는다. 접미사 그대로의 주소
// (smarthub.example.com)는 관리자용으로 지금처럼 전부 열린다. 팀이 늘어도 코드·인그레스는 그대로다:
// 백오피스에서 허브를 만들면 <새 허브키>.<접미사>가 바로 그 팀 주소가 된다(인그레스는 와일드카드 호스트).
//
// 진짜 경계는 서버다 — 화면(App.jsx)이 링크를 숨기는 것은 편의일 뿐이다. 팀 주소에서는
//   - /api/admin/*                     → 404 (관리자 API가 있다는 것도 알리지 않는다)
//   - 다른 허브(/api/hubs/:key, ?hub=, 본문 hub, 전체 허브 *) → 404
//   - 허브를 안 적은 모듈 API          → 팀 허브로 고정(모듈의 기본 허브 cs로 새지 않게)
// TEAM_HOST_SUFFIX가 없으면(외부 에디션·로컬) 아무것도 하지 않는다. CronJob은 서비스 주소로 부르므로 영향 없다.
const KEY_RE = /^[a-z0-9-]+$/   // 허브 키 규칙(routes/admin.js)과 같다 — 점이 없어 한 단계 이름만 맞는다

/** Host 헤더에서 팀 허브 키를 꺼낸다. 팀 주소가 아니면 null. */
export function teamHubOf(host, suffix = process.env.TEAM_HOST_SUFFIX) {
  if (!suffix || !host) return null
  const name = String(host).toLowerCase().replace(/:\d+$/, '')
  const tail = '.' + suffix.toLowerCase().replace(/^\./, '')
  if (!name.endsWith(tail)) return null
  const key = name.slice(0, -tail.length)
  return KEY_RE.test(key) ? key : null
}

export function teamHostGuard(suffix = process.env.TEAM_HOST_SUFFIX) {
  return function teamHost(req, res, next) {
    const key = teamHubOf(req.headers.host, suffix)
    if (!key) return next()
    req.teamHub = key
    // Express 라우팅은 대소문자를 가리지 않는다(/API/admin도 관리자 API에 닿는다) — 관문도 소문자로 본다(2026-11-10 사내 QA).
    const path = req.path.toLowerCase()
    if (!path.startsWith('/api/')) return next()

    const notFound = () => res.status(404).json({ error: 'not found' })
    if (/^\/api\/admin(\/|$)/.test(path)) return notFound()
    const pathHub = path.match(/^\/api\/hubs\/([^/]+)/)
    if (pathHub && decodeURIComponent(pathHub[1]) !== key) return notFound()
    for (const given of [req.query?.hub, req.body?.hub]) {
      if (given !== undefined && given !== key) return notFound()
    }
    req.query.hub = key
    next()
  }
}
