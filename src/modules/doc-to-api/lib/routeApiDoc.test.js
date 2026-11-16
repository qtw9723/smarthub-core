// routeApiDoc — 문서 분기 판정. openapi면 브라우저 결정론 파싱(LLM 0),
// freeform이면 프록시를 통해 LLM을 탄다.
import { describe, it, expect } from 'vitest'
import { routeApiDoc } from './routeApiDoc.js'

describe('routeApiDoc', () => {
  it('빈 문자열은 freeform', () => {
    expect(routeApiDoc('')).toBe('freeform')
    expect(routeApiDoc('   ')).toBe('freeform')
    expect(routeApiDoc(null)).toBe('freeform')
  })

  it('루트에 openapi 키가 있는 JSON은 openapi', () => {
    expect(routeApiDoc('{"openapi":"3.0.0","paths":{}}')).toBe('openapi')
  })

  it('루트에 swagger 키가 있는 JSON은 openapi', () => {
    expect(routeApiDoc('{"swagger":"2.0"}')).toBe('openapi')
  })

  it('루트에 paths만 있어도 openapi', () => {
    expect(routeApiDoc('{"paths":{"/a":{}}}')).toBe('openapi')
  })

  it('openapi: 로 시작하는 YAML은 openapi', () => {
    expect(routeApiDoc('openapi: 3.0.0\npaths:\n  /a: {}')).toBe('openapi')
  })

  it('swagger: 로 시작하는 YAML은 openapi', () => {
    expect(routeApiDoc('swagger: "2.0"\ninfo:\n  title: x')).toBe('openapi')
  })

  it('자유형식 한국어 문서는 freeform', () => {
    expect(routeApiDoc('POST /v1/orders — 주문 생성. 요청: customerId(필수)')).toBe('freeform')
  })

  it('OpenAPI 키가 없는 JSON은 freeform', () => {
    expect(routeApiDoc('{"name":"x","items":[]}')).toBe('freeform')
  })

  it('깨진 JSON은 YAML 접두 검사로 폴백한다', () => {
    expect(routeApiDoc('{"openapi": ')).toBe('freeform')
    expect(routeApiDoc('openapi: 3.0.0\n{broken')).toBe('openapi')
  })
})
