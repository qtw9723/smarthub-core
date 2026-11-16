// src/lib/auth.js — 브라우저가 들고 있는 비밀번호들.
//
// 두 종류가 있고 서로 독립이다(README "인증 경계"):
//   - 플랫폼 비밀번호: 허브 목록(`/`)·백오피스(`/admin`) 진입용. 쿠키 하나.
//   - 허브 비밀번호: 허브마다 하나씩. cs에 로그인해도 delivery는 열리지 않는다.
// 플랫폼 비밀번호는 마스터키라 허브 API도 통과시킨다 — 그래서 요청에는 둘 다 실어 보낸다.
export const COOKIE_NAME = 'smarthub-password'
const HUB_COOKIE_PREFIX = 'smarthub-hub-'
const COOKIE_DAYS = 100

function readCookie(name) {
  const match = document.cookie.split('; ').find(r => r.startsWith(name + '='))
  return match ? decodeURIComponent(match.split('=')[1]) : ''
}

function writeCookie(name, value) {
  const expires = new Date(Date.now() + COOKIE_DAYS * 24 * 60 * 60 * 1000).toUTCString()
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Strict`
}

function eraseCookie(name) {
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Strict`
}

// ── 플랫폼(허브 목록·백오피스) ──────────────────────────────────────────
export function getCookie() { return readCookie(COOKIE_NAME) }
export function setCookie(value) { writeCookie(COOKIE_NAME, value) }
export function clearCookie() { eraseCookie(COOKIE_NAME) }

// ── 허브별 ──────────────────────────────────────────────────────────────
// 허브 key를 쿠키 이름에 넣으므로 인코딩한다(key는 소문자·숫자·하이픈이지만,
// 빈 key로 들어와 접두사만 남은 쿠키를 만드는 일이 없도록 방어한다).
export function hubCookieName(hubKey) { return `${HUB_COOKIE_PREFIX}${encodeURIComponent(hubKey)}` }

export function getHubCookie(hubKey) { return hubKey ? readCookie(hubCookieName(hubKey)) : '' }
export function setHubCookie(hubKey, value) { if (hubKey) writeCookie(hubCookieName(hubKey), value) }
export function clearHubCookie(hubKey) { if (hubKey) eraseCookie(hubCookieName(hubKey)) }

/**
 * 허브 비밀번호를 헤더에 실을 수 있는 형태로 인코딩한다.
 *
 * HTTP 헤더 값은 latin-1이라 한글을 그대로 넣을 수 없다 — `fetch`가 "Invalid value"로
 * 던져버려서 로그인 자체가 실패한다. 퍼센트 인코딩해서 보내고 서버(server/lib/hubAuth.js의
 * headerPassword)가 되돌린다. ASCII 비밀번호는 인코딩해도 자기 자신이라 영향이 없다.
 */
export function encodeHubPassword(value) {
  return value ? encodeURIComponent(value) : ''
}

/**
 * 허브 스코프 API 호출에 실을 인증 헤더.
 * 두 비밀번호를 모두 보낸다 — 서버는 허브 비밀번호를 보고, 플랫폼 비밀번호는 마스터키로 받는다.
 */
export function hubAuthHeaders(hubKey) {
  return {
    'x-app-password': getCookie(),
    'x-hub-password': encodeHubPassword(getHubCookie(hubKey)),
  }
}
