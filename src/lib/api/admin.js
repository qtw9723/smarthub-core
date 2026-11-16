// src/lib/api/admin.js
const BASE = import.meta.env.VITE_API_BASE_URL ?? ''

// 로그인 시도 제한(서버 429, server/lib/authThrottle.js) — 화면이 "몇 분 뒤"를 알려 줄 수 있게.
export const TOO_MANY_ATTEMPTS = 'TOO_MANY_ATTEMPTS'
export function tooManyAttempts(body) {
  const err = new Error(TOO_MANY_ATTEMPTS)
  err.retryAfterMinutes = body?.retryAfterMinutes ?? 15
  return err
}

async function request(method, path, body = null, password) {
  const res = await fetch(`${BASE}/api/admin${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-app-password': password ?? '',
    },
    body: body ? JSON.stringify(body) : null,
  })
  if (res.status === 401) throw new Error('UNAUTHORIZED')
  if (res.status === 429) throw tooManyAttempts(await res.json().catch(() => null))
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `HTTP ${res.status}`)
  }
  if (method === 'DELETE') return null
  return res.json()
}

export const getHubs = (pw) => request('GET', '/hubs', null, pw)
export const createHub = (hub, pw) => request('POST', '/hubs', hub, pw)
export const updateHub = (id, patch, pw) => request('PATCH', `/hubs/${id}`, patch, pw)
export const deleteHub = (id, pw) => request('DELETE', `/hubs/${id}`, null, pw)
// 허브 비밀번호 설정/해제. password가 빈 문자열이면 해제 = 그 허브는 공개가 된다.
export const setHubPassword = (id, password, pw) => request('PUT', `/hubs/${id}/password`, { password }, pw)
// 마스터 키 바꾸기 — 지금 키(pw)로 인증, next가 새 키.
export const changeMasterKey = (next, pw) => request('PUT', '/master-key', { next }, pw)
export const getOverview = (pw) => request('GET', '/overview', null, pw)
export const getActivity = (pw) => request('GET', '/activity', null, pw)
export const getAdminModules = (pw) => request('GET', '/modules', null, pw)
// idOrKey = hub UUID 또는 key
export const getHubFeatures = (idOrKey, pw) => request('GET', `/hubs/${idOrKey}/features`, null, pw)
export const setHubFeature = (idOrKey, key, patch, pw) => request('PUT', `/hubs/${idOrKey}/features/${key}`, patch, pw)

// 모듈 보안 레벨(2026-11-09). GET → { modules: [{ key, defaultLevel, level, reason, updated_at }] }.
// 기본보다 낮추면 reason 필수(서버 400 REASON_REQUIRED). 기본값과 같은 레벨로 저장하면 조정이 지워진다.
export const getSecurity = (pw) => request('GET', '/security', null, pw)
export const setModuleSecurity = (key, body, pw) => request('PUT', `/security/${key}`, body, pw)
// 확인된 예외: level = 확인 시점의 요구 레벨, null = 예외 해제.
export const setHubSecurityAck = (id, level, pw) => request('PUT', `/hubs/${id}/security-ack`, { level }, pw)
