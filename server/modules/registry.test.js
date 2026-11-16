// 모듈 레지스트리 계약·확장성 검증 (R2)
import { describe, it, expect, vi } from 'vitest'
// 모듈 로드 시 db.js(createClient)가 env 없이 던지지 않도록 mock
vi.mock('../db.js', () => ({ default: { from: () => ({}) } }))
import { getModules, getModule } from './index.js'
import { MODULE_SECURITY_DEFAULTS } from '../../shared/securityPolicy.js'

describe('server 모듈 레지스트리', () => {
  it('chatbot-monitoring 모듈이 등록돼 있다', () => {
    const keys = getModules().map(m => m.key)
    expect(keys).toContain('chatbot-monitoring')
  })

  it('모든 모듈이 계약(key 필수 · apiRouter/overview 옵셔널)을 만족한다', () => {
    for (const m of getModules()) {
      expect(typeof m.key).toBe('string')
      // 무상태 툴 모듈은 서버 파트가 없다 — 있으면 타입만 검사한다.
      if (m.apiRouter !== undefined) expect(m.apiRouter).toBeTruthy()
      if (m.overview !== undefined) expect(typeof m.overview).toBe('function')
    }
  })

  // 보안 레벨 기본값 표에 빠진 서버 모듈은 L2로 떨어지고(안전), GET /admin/security에 이유 없이 보인다 —
  // 클라 레지스트리와 같은 대조를 서버 쪽에도 둔다(리뷰 지적).
  it('모든 서버 모듈이 보안 레벨 기본값 표에 있다', () => {
    for (const m of getModules()) expect(MODULE_SECURITY_DEFAULTS[m.key], m.key).toBeTruthy()
  })

  it('getModule은 알 수 없는 키에 null', () => {
    expect(getModule('nope')).toBeNull()
    expect(getModule('chatbot-monitoring')).not.toBeNull()
  })

  // 확장성: 배열 등록만으로 편입되는 구조 → 등록 개수가 1개 이상이고 key가 유일
  it('모듈 key는 유일하다', () => {
    const keys = getModules().map(m => m.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('apiRouter 없는 모듈이 있어도 마운트 루프가 안전하다', async () => {
    const express = (await import('express')).default
    const app = express()
    const modules = [...getModules(), { key: 'stateless-tool' }]
    expect(() => {
      for (const m of modules) if (m.apiRouter) app.use(`/api/modules/${m.key}`, m.apiRouter)
    }).not.toThrow()
  })
})
