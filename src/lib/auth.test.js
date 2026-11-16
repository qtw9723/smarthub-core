import { describe, it, expect, beforeEach } from 'vitest'
import {
  getCookie, setCookie, clearCookie, COOKIE_NAME,
  getHubCookie, setHubCookie, clearHubCookie, hubCookieName, hubAuthHeaders, encodeHubPassword,
} from './auth.js'

beforeEach(() => {
  for (const name of [COOKIE_NAME, hubCookieName('cs'), hubCookieName('delivery')]) {
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/`
  }
})

describe('getCookie', () => {
  it('쿠키가 없으면 빈 문자열 반환', () => {
    expect(getCookie()).toBe('')
  })
  it('setCookie 후 getCookie로 값 읽기', () => {
    setCookie('secret123')
    expect(getCookie()).toBe('secret123')
  })
})

describe('clearCookie', () => {
  it('clearCookie 후 getCookie는 빈 문자열', () => {
    setCookie('secret123')
    clearCookie()
    expect(getCookie()).toBe('')
  })
})

describe('허브별 쿠키', () => {
  it('허브마다 따로 저장·조회된다', () => {
    setHubCookie('cs', 'cs-pw')
    setHubCookie('delivery', 'delivery-pw')
    expect(getHubCookie('cs')).toBe('cs-pw')
    expect(getHubCookie('delivery')).toBe('delivery-pw')
  })

  it('cs에 로그인해도 delivery는 열리지 않는다 — 허브 인증은 서로 독립', () => {
    setHubCookie('cs', 'cs-pw')
    expect(getHubCookie('delivery')).toBe('')
  })

  it('한 허브만 해제해도 다른 허브는 남는다', () => {
    setHubCookie('cs', 'cs-pw')
    setHubCookie('delivery', 'delivery-pw')
    clearHubCookie('cs')
    expect(getHubCookie('cs')).toBe('')
    expect(getHubCookie('delivery')).toBe('delivery-pw')
  })

  it('플랫폼 쿠키와 이름이 겹치지 않는다', () => {
    setCookie('platform-pw')
    setHubCookie('cs', 'cs-pw')
    expect(getCookie()).toBe('platform-pw')
    expect(getHubCookie('cs')).toBe('cs-pw')
  })

  it('허브 key가 없으면 아무것도 저장하지 않는다', () => {
    setHubCookie('', 'x')
    expect(getHubCookie('')).toBe('')
  })
})

describe('hubAuthHeaders', () => {
  it('플랫폼·허브 비밀번호를 모두 실어 보낸다 — 서버가 마스터키를 함께 본다', () => {
    setCookie('platform-pw')
    setHubCookie('cs', 'cs-pw')
    expect(hubAuthHeaders('cs')).toEqual({
      'x-app-password': 'platform-pw',
      'x-hub-password': 'cs-pw',
    })
  })

  it('없는 값은 빈 문자열 — 헤더 자체는 항상 붙는다', () => {
    expect(hubAuthHeaders('cs')).toEqual({ 'x-app-password': '', 'x-hub-password': '' })
  })

  // HTTP 헤더 값은 latin-1이라 한글을 그대로 넣으면 fetch가 던진다.
  it('한글 비밀번호는 퍼센트 인코딩해 싣는다 — 헤더에 원문이 그대로 들어가지 않는다', () => {
    setHubCookie('cs', '한글비밀번호')
    const headers = hubAuthHeaders('cs')
    expect(headers['x-hub-password']).toBe(encodeURIComponent('한글비밀번호'))
    // latin-1 안전한지: 모든 문자가 0xFF 이하
    expect([...headers['x-hub-password']].every(c => c.charCodeAt(0) <= 0xff)).toBe(true)
  })

  it('ASCII 비밀번호는 인코딩해도 자기 자신', () => {
    expect(encodeHubPassword('cs-pw')).toBe('cs-pw')
  })

  it('빈 값은 빈 문자열', () => {
    expect(encodeHubPassword('')).toBe('')
  })
})
