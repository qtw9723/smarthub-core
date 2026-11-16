// 붙여넣기와 파일 업로드가 **같은 경로**를 쓰는지 고정한다.
//
// 예전에는 두 입력이 각자 구현을 갖고 있었다. 파일은 extractApiDefsFromFile을 지나며
// source('openapi'|'llm')를 돌려줬지만, 붙여넣기는 HubPanel 안에서 직접 파싱해
// source를 만들지 않았다 — 같은 문서를 붙여넣으면 "어떻게 추출됐는지" 배지가 사라졌다.
// 구현이 둘이면 한쪽만 고치는 드리프트도 생긴다.
import { describe, it, expect, vi } from 'vitest'
import { extractApiDefsFromText } from './extractApiDefs.js'

const OPENAPI = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 't', version: '1' },
  paths: { '/ping': { get: { summary: '핑', responses: { 200: { description: 'ok' } } } } },
})

describe('extractApiDefsFromText', () => {
  it('OpenAPI 3.x는 결정론 파서로 처리하고 LLM을 부르지 않는다', async () => {
    const callApiDocParse = vi.fn()
    const r = await extractApiDefsFromText(OPENAPI, { callApiDocParse })
    expect(r.source).toBe('openapi')
    expect(r.defs.length).toBeGreaterThan(0)
    expect(r.error).toBeNull()
    expect(callApiDocParse).not.toHaveBeenCalled()
  })

  it('자유형식 문서는 LLM으로 넘긴다', async () => {
    const callApiDocParse = vi.fn(async () => ({ defs: [{ name: 'a' }] }))
    const r = await extractApiDefsFromText('회원 조회 API가 있습니다', { callApiDocParse })
    expect(r.source).toBe('llm')
    expect(r.defs).toEqual([{ name: 'a' }])
    expect(callApiDocParse).toHaveBeenCalledWith('회원 조회 API가 있습니다')
  })

  // routeApiDoc은 swagger 2.0도 'openapi'로 분류하지만 결정론 파서는 openapi 3.x만 받는다.
  it('OpenAPI로 분류됐어도 결정론 파싱이 비면 LLM으로 떨어진다', async () => {
    const callApiDocParse = vi.fn(async () => ({ defs: [{ name: 'b' }] }))
    const r = await extractApiDefsFromText(JSON.stringify({ swagger: '2.0', paths: {} }), { callApiDocParse })
    expect(r.source).toBe('llm')
    expect(r.defs).toEqual([{ name: 'b' }])
  })

  it('LLM도 못 찾으면 오류를 돌려준다', async () => {
    const r = await extractApiDefsFromText('아무 말', { callApiDocParse: async () => ({ defs: [] }) })
    expect(r.defs).toEqual([])
    expect(r.error).toBeTruthy()
  })

  it('빈 문서는 LLM을 부르지 않고 오류', async () => {
    const callApiDocParse = vi.fn()
    const r = await extractApiDefsFromText('   ', { callApiDocParse })
    expect(r.error).toBeTruthy()
    expect(callApiDocParse).not.toHaveBeenCalled()
  })

  it('LLM 응답이 배열이 아니어도 깨지지 않는다', async () => {
    const r = await extractApiDefsFromText('아무 말', { callApiDocParse: async () => ({ defs: 'nope' }) })
    expect(r.defs).toEqual([])
    expect(r.error).toBeTruthy()
  })

  // 상류 정책: LLM 호출이 던져도 반환 계약으로 돌려준다. `/parse`는 시간당 상한(429)이
  // 있어 던지는 경로가 실제로 존재한다 — 던지면 호출부마다 따로 막아야 한다.
  it('LLM 호출이 던져도 던지지 않고 error로 돌려준다(429 등)', async () => {
    const callApiDocParse = vi.fn(async () => { throw new Error('시간당 호출 한도를 넘었습니다') })
    const r = await extractApiDefsFromText('주문 조회 API: GET /orders', { callApiDocParse })
    expect(r).toEqual({ defs: [], source: 'llm', error: '시간당 호출 한도를 넘었습니다' })
  })
})
