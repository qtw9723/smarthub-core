// 메일에 싣는 앱 링크의 주소. 사내는 팀 주소(<허브키>.<TEAM_HOST_SUFFIX>) — 받는 사람이 hosts에 넣은 주소가 그것이다.
import { describe, it, expect } from 'vitest'
import { hubBaseUrl, hubPageUrl } from './hubUrl.js'

describe('hubBaseUrl', () => {
  it('사내(TEAM_HOST_SUFFIX)는 그 허브의 팀 주소, http', () => {
    expect(hubBaseUrl('cs', { TEAM_HOST_SUFFIX: 'smarthub.example.com' })).toBe('http://cs.smarthub.example.com')
    expect(hubBaseUrl('delivery', { TEAM_HOST_SUFFIX: '.smarthub.example.com' })).toBe('http://delivery.smarthub.example.com')
  })
  it('팀 주소가 정해 둔 주소(APP_BASE_URL 등)보다 앞선다 — 팀원은 관리자 주소를 hosts에 넣지 않는다', () => {
    expect(hubBaseUrl('cs', { TEAM_HOST_SUFFIX: 'smarthub.example.com', PUBLIC_URL: 'http://smarthub.example.com' })).toBe('http://cs.smarthub.example.com')
  })
  it('외부는 지금처럼 — APP_BASE_URL > HUB_URL > PUBLIC_URL > Vercel 운영 주소, 끝 / 제거', () => {
    expect(hubBaseUrl('cs', { APP_BASE_URL: 'https://a.example/', HUB_URL: 'https://b' })).toBe('https://a.example')
    expect(hubBaseUrl('cs', { HUB_URL: 'https://b.example' })).toBe('https://b.example')
    expect(hubBaseUrl('cs', { VERCEL_PROJECT_PRODUCTION_URL: 'smarthub-demo.vercel.app' })).toBe('https://smarthub-demo.vercel.app')
  })
  it('아무것도 없으면 빈 문자열 — 링크를 빼라는 뜻', () => {
    expect(hubBaseUrl('cs', {})).toBe('')
  })
})

describe('hubPageUrl', () => {
  it('허브 안의 모듈 페이지', () => {
    expect(hubPageUrl('cs', 'module-c', { TEAM_HOST_SUFFIX: 'smarthub.example.com' })).toBe('http://cs.smarthub.example.com/hub/cs/module-c')
  })
  it('주소를 모르면 빈 문자열', () => {
    expect(hubPageUrl('cs', 'module-c', {})).toBe('')
  })
})
