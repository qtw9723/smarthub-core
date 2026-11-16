// server/lib/hubAuth.js — 허브 스코프 인증 미들웨어.
//
// 인증 경계(전체 그림은 README "인증 경계"):
//   - 플랫폼 진입점(`/`·`/admin` → /api/admin/*)은 APP_PASSWORD.
//   - 개별 허브(/hub/:hubKey)와 그 모듈 API는 **그 허브의 비밀번호**(hubs.password_hash).
//   - 허브에 비밀번호가 없으면(NULL) 그 허브는 공개다.
//   - APP_PASSWORD는 마스터키 — 모든 허브를 연다.
//   - 자동 트리거(Bearer CRON_SECRET)는 이 검사를 지나간다. 그 경로의 인가는 각 라우터의
//     cronAuth가 하며, CRON_SECRET은 사용자 비밀이 아니라 서버 비밀이다.
import { verifyPassword } from './hubPassword.js'
import { repos } from '../data/index.js'
import { isMasterKey } from './masterKey.js'
import { isBlocked, noteFailure, sendBlocked } from './authThrottle.js'

export const HUB_PASSWORD_REQUIRED = 'HUB_PASSWORD_REQUIRED'

/** 요청이 대상으로 삼는 허브 key. 모듈 라우터가 이미 쓰는 규칙(?hub= → body.hub → 기본값)과 같다. */
export function hubKeyOf(req, defaultHub) {
  return req.query?.hub || req.body?.hub || defaultHub
}

// 유효한 CRON_SECRET Bearer인지. **일치할 때만** 통과시킨다 —
// 아무 Bearer나 허용하면 헤더 하나로 허브 비밀번호를 우회할 수 있다.
function isCronRequest(req) {
  const secret = process.env.CRON_SECRET
  return !!secret && req.headers['authorization'] === `Bearer ${secret}`
}

/**
 * x-hub-password 헤더에서 평문을 꺼낸다.
 *
 * HTTP 헤더 값은 latin-1이라 한글을 그대로 실을 수 없다 — 브라우저 fetch는 아예 던지고,
 * 다른 클라이언트는 조용히 깨진 바이트를 보낸다. 그래서 클라이언트가 퍼센트 인코딩해서
 * 보내고(src/lib/auth.js의 hubAuthHeaders) 여기서 되돌린다.
 *
 * 인코딩되지 않은 값(curl로 직접 부르는 ASCII 비밀번호 등)도 그대로 통과해야 하므로,
 * 디코딩이 실패하면 원문을 쓴다. ASCII 비밀번호는 인코딩해도 자기 자신이라 양쪽이 같다.
 */
function headerPassword(req) {
  const raw = req.headers['x-hub-password']
  if (typeof raw !== 'string' || raw === '') return ''
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw // 잘못된 퍼센트 시퀀스 — 인코딩하지 않은 값으로 본다
  }
}

// 마스터 키(백오피스에서 바꾼 키 또는 APP_PASSWORD). 둘 다 없으면 아무나 통과하지 않도록 false — server/lib/masterKey.js.
const isMaster = (req) => isMasterKey(req.headers['x-app-password'])

/**
 * 허브 비밀번호를 요구하는 미들웨어를 만든다.
 * @param {string} [defaultHub]  ?hub=가 없을 때 대상이 되는 허브 key (라우터마다 다르다).
 *   생략하면 hub 지정이 **필수**가 된다(무상태 툴처럼 기본 허브가 없는 라우터).
 */
export function requireHubAccess(defaultHub) {
  return async function hubAuth(req, res, next) {
    if (isCronRequest(req)) return next()

    const key = hubKeyOf(req, defaultHub)
    // 기본 허브가 없는 라우터에서 hub를 안 주면, 어느 허브의 비밀번호를 물어야 할지 알 수 없다.
    // 통과시키면 hub를 빼는 것만으로 인증을 건너뛸 수 있으므로 거절한다.
    if (!key) return res.status(400).json({ error: 'hub 파라미터가 필요합니다' })

    try {
      // 조회 오류는 '없음'과 같게 본다(이전 동작 — 404).
      const hub = await repos.hubs.getHubByKey(key).catch(() => null)

      // 없는 허브를 통과시키면 ?hub=아무거나로 인증을 우회할 수 있다. 라우터들도 어차피
      // 같은 값에 404를 내므로(resolveHubId 실패) 여기서 막아도 새로 새는 정보는 없다.
      if (!hub) return res.status(404).json({ error: 'unknown hub' })

      // 비밀번호가 없는 허브는 공개다 — 확인할 것이 없으니 시도 제한도 보지 않는다(요청마다 DB를 세지 않게).
      if (!hub.password_hash) return next()

      // 비밀번호(또는 마스터 키) 확인 전에 시도 제한부터 — 막힌 동안은 맞는 값도 통과시키지 않는다(lib/authThrottle.js).
      const { blocked, retryAfterSec } = await isBlocked(req)
      if (blocked) return sendBlocked(res, retryAfterSec)

      if ((await isMaster(req)) || verifyPassword(headerPassword(req), hub.password_hash)) return next()

      if (req.headers['x-hub-password'] || req.headers['x-app-password']) await noteFailure(req)
      // 이 허브가 무엇인지(이름)는 알려준다 — 잠금 화면에 띄워야 하기 때문이다.
      return res.status(401).json({
        error: HUB_PASSWORD_REQUIRED,
        hub: { key: hub.key, name: hub.name },
      })
    } catch (e) {
      return res.status(500).json({ error: e.message })
    }
  }
}
