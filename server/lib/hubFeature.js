// server/lib/hubFeature.js — "이 허브에서 이 모듈이 켜져 있는가" 미들웨어.
//
// hubAuth와 묻는 것이 다르다:
//   - requireHubAccess : 당신이 이 허브에 들어와도 되는가 (비밀번호)
//   - requireHubFeature: 그 허브가 이 기능을 쓰기로 했는가 (hub_features)
//
// 둘은 독립이라 순서대로 겹쳐 쓴다(인증 → 기능). 인증만 있으면, 기능을 켠 적 없는 허브
// 이름을 붙이는 것만으로 그 모듈의 부수효과(예: 외부 API 호출의 **비용 청구**)를
// 일으킬 수 있다. 백오피스의 모듈 on/off가 UI 표시용이 아니라 실제 경계가 되게 하는 검사다.
//
// APP_PASSWORD 마스터키는 여기서 통하지 않는다 — 마스터키는 인증 우회이지,
// 켠 적 없는 기능의 사용 허가가 아니다.
import { hubKeyOf } from './hubAuth.js'
import { repos } from '../data/index.js'

/**
 * 대상 허브에서 featureKey가 활성일 때만 통과시키는 미들웨어를 만든다.
 * @param {string} featureKey  모듈 레지스트리의 key (예: 'chatbot-monitoring')
 * @param {string} [defaultHub]  ?hub=가 없을 때의 대상 허브. 생략하면 hub 지정이 필수다.
 */
export function requireHubFeature(featureKey, defaultHub) {
  return async function hubFeature(req, res, next) {
    const key = hubKeyOf(req, defaultHub)
    if (!key) return res.status(400).json({ error: 'hub 파라미터가 필요합니다' })

    try {
      // 조회 오류는 '없음'과 같게 본다(이전 동작 — 404).
      const hub = await repos.hubs.getHubByKey(key).catch(() => null)
      // 없는 허브·꺼진 허브는 다른 라우터와 같은 404로 통일한다.
      if (!hub || !hub.enabled) return res.status(404).json({ error: 'unknown hub' })

      const feature = await repos.features.getFeature(hub.id, featureKey).catch(() => null)

      // 행이 없으면 = 한 번도 켠 적 없음. 켜짐만 통과.
      if (!feature?.enabled) return res.status(404).json({ error: 'feature not enabled' })

      // 뒤 라우터가 허브를 다시 조회하지 않도록 해석 결과를 넘겨준다.
      req.hub = { key, id: hub.id }
      return next()
    } catch (e) {
      return res.status(500).json({ error: e.message })
    }
  }
}
