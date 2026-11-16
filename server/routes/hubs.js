// server/routes/hubs.js — 허브 진입용 조회.
//
// 인증 경계: 비밀번호는 **플랫폼 진입점**(허브 목록 `/` · 백오피스 `/admin`)을 APP_PASSWORD로,
// **개별 허브**(/hub/:hubKey)를 그 허브의 비밀번호(hubs.password_hash)로 지킨다.
// 허브에 비밀번호가 없으면 그 허브는 공개다. 전체 표: README "인증 경계".
//
// 어드민 경로(/api/admin/hubs/:idOrKey/features)와 따로 두는 이유는, 허브 하나에 들어가려고
// 백오피스 전체를 열 수는 없기 때문이다. 여기서는 그 허브에 필요한 것만 준다:
//   - enabled=true 모듈만 (어드민은 매트릭스 전체가 필요하므로 꺼진 것도 반환)
//   - `config` 미반환 (수신자 주소·환경 설정 등이 들어가는 필드)
//   - hub.id 미반환 (허브 페이지는 key만 쓴다)
//   - 비활성 허브는 404 (허브 목록에서도 숨겨지는 허브다)
import { Router } from 'express'
import { requireHubAccess } from '../lib/hubAuth.js'
import { repos } from '../data/index.js'

const router = Router()

// 요청 경로의 :hubKey를 hubAuth가 보는 자리(req.query.hub)로 옮긴다.
// hubAuth는 모듈 라우터 규칙(?hub=)에 맞춰져 있고, 이 라우터만 경로 파라미터를 쓴다.
function hubKeyFromPath(req, _res, next) {
  req.query = { ...req.query, hub: req.params.hubKey }
  next()
}

// GET /api/hubs/:hubKey — 잠금 화면이 필요로 하는 최소 정보. **항상 공개**다.
// 비밀번호를 물어보려면 어느 허브인지(이름)와 물어봐야 하는지(requiresPassword)를 먼저 알아야 한다.
router.get('/:hubKey', async (req, res) => {
  try {
    const hub = await repos.hubs.getHubByKey(req.params.hubKey).catch(() => null)
    if (!hub || !hub.enabled) return res.status(404).json({ error: 'unknown hub' })
    res.json({ key: hub.key, name: hub.name, requiresPassword: !!hub.password_hash })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// GET /api/hubs/:hubKey/features — 이 허브가 켠 모듈 목록. 허브 비밀번호가 걸려 있으면 요구한다.
router.get('/:hubKey/features', hubKeyFromPath, requireHubAccess(), async (req, res) => {
  try {
    const hub = await repos.hubs.getHubByKey(req.params.hubKey).catch(() => null)
    if (!hub || !hub.enabled) return res.status(404).json({ error: 'unknown hub' })

    const data = await repos.features.listPublic(hub.id)

    res.json({
      hub: { key: hub.key, name: hub.name },
      // select가 이미 config를 빼지만, 필드를 명시적으로 다시 세워 공개 응답의
      // 모양을 이 파일 안에서 고정한다(select 문자열이 나중에 넓어져도 새지 않도록).
      features: (data ?? [])
        .filter(f => f.enabled)
        .map(f => ({ feature_key: f.feature_key, enabled: f.enabled, sort_order: f.sort_order })),
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

export default router
