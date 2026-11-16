// src/lib/api/hubs.js — 허브 진입 조회.
// 인증이 필요한 백오피스 호출은 src/lib/api/admin.js를 쓴다.
import { hubAuthHeaders, encodeHubPassword } from '../auth.js'
import { tooManyAttempts } from './admin.js'

const BASE = import.meta.env.VITE_API_BASE_URL ?? ''

export const UNKNOWN_HUB = 'UNKNOWN_HUB'
export const HUB_PASSWORD_REQUIRED = 'HUB_PASSWORD_REQUIRED'
export { TOO_MANY_ATTEMPTS } from './admin.js'

// 서버가 내려준 HUB_PASSWORD_REQUIRED를 잠금 화면이 쓸 수 있는 오류로 만든다.
// 허브 이름은 잠금 화면에 띄워야 하므로 오류에 붙여 나른다.
function hubLockedError(body) {
  const err = new Error(HUB_PASSWORD_REQUIRED)
  err.hub = body?.hub ?? null
  return err
}

/** GET /api/hubs/:hubKey — { key, name, requiresPassword }. 항상 공개. */
export async function getHubMeta(hubKey) {
  const res = await fetch(`${BASE}/api/hubs/${encodeURIComponent(hubKey)}`)
  if (res.status === 404) throw new Error(UNKNOWN_HUB)
  if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`)
  return res.json()
}

/**
 * GET /api/hubs/:hubKey/features — 이 허브가 켠 모듈 목록.
 * 허브 비밀번호가 걸려 있으면 HUB_PASSWORD_REQUIRED로 던진다(err.hub에 { key, name }).
 * @param {string} hubKey
 * @param {string} [hubPassword] 방금 입력한 비밀번호(쿠키에 저장하기 전 검증용).
 *   생략하면 저장된 쿠키를 쓴다.
 */
export async function getPublicHubFeatures(hubKey, hubPassword) {
  const res = await fetch(`${BASE}/api/hubs/${encodeURIComponent(hubKey)}/features`, {
    headers: {
      ...hubAuthHeaders(hubKey),
      ...(hubPassword ? { 'x-hub-password': encodeHubPassword(hubPassword) } : {}),
    },
  })
  if (res.status === 404) throw new Error(UNKNOWN_HUB)
  if (res.status === 401) throw hubLockedError(await res.json().catch(() => null))
  if (res.status === 429) throw tooManyAttempts(await res.json().catch(() => null))
  if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`)
  return res.json()
}
