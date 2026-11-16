// 문서 종류 분기 계약 — 모듈 B의 비용·가용성 특성을 고정한다.
//
// OpenAPI 3.x → 브라우저 결정론 파서로 완결. LLM 호출 0 (프록시 미사용).
// 자유형식     → 프록시를 통해 LLM.
// 상류 장애    → 자유형식만 실패하고 OpenAPI 경로는 계속 동작(graceful degradation).
//
// "LLM을 호출하지 않았다"는 스파이가 호출되면 실패시키는 방식으로 단정한다.
//
// ⚠ 범위 한정: 이 파일의 모든 케이스는 **파일 업로드 경로**(extractApiDefsFromFile)를 태운다.
// 붙여넣기 경로(doc-to-api/HubPanel.jsx의 generate)는 routeApiDoc 판정을 거치지 않고
// parseApiDocToDefs를 먼저 돌린 뒤 결과가 비면 프록시로 폴백하는 **별개 구현**이며 여기서
// 커버되지 않는다. 위 계약을 붙여넣기 경로까지 고정하려면 별도 테스트가 필요하다.
import { describe, it, expect, vi } from 'vitest'
// jsdom(26)의 File/Blob은 .text()/.arrayBuffer()를 구현하지 않는다(jsdom 자체 제약,
// https://github.com/jsdom/jsdom#unimplemented-parts-of-the-spec 참고).
// extractFileText가 file.text()를 호출하므로 Node 내장 File(node:buffer, undici 기반,
// 완전한 Blob 구현)을 대신 사용한다 — 이식 로직·환경설정은 건드리지 않고 테스트 파일 안에서만 해결.
import { File } from 'node:buffer'
import { extractApiDefsFromFile } from './extractApiDefsFromFile.js'
import { extractFileText } from './extractFileText.js'
import { routeApiDoc } from './routeApiDoc.js'

const OPENAPI_DOC = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'Sample', version: '1.0' },
  paths: {
    '/v1/orders': {
      post: {
        operationId: 'createOrder',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { customerId: { type: 'string' }, amount: { type: 'number' } },
              },
            },
          },
        },
        responses: { 200: { description: 'ok' } },
      },
    },
  },
}, null, 2)

const FREEFORM_DOC =
  'POST /v1/orders — 주문 생성. 요청: customerId(string, 필수), amount(number). 응답: orderId(string).'

function jsonFile(text, name = 'openapi.json') {
  return new File([text], name, { type: 'application/json' })
}

function txtFile(text, name = 'spec.txt') {
  return new File([text], name, { type: 'text/plain' })
}

describe('문서 종류 분기', () => {
  it('OpenAPI 문서는 LLM을 호출하지 않는다', async () => {
    // 호출되면 즉시 실패시키는 스파이 — "안 불렸다"를 사후 확인이 아니라 계약으로 만든다.
    const callApiDocParse = vi.fn(() => {
      throw new Error('OpenAPI 문서인데 LLM이 호출됐다 — 분기 계약 위반')
    })

    const { defs, source, error } = await extractApiDefsFromFile(jsonFile(OPENAPI_DOC), {
      extractText: extractFileText,
      callApiDocParse,
    })

    expect(error).toBeNull()
    expect(source).toBe('openapi')
    expect(callApiDocParse).not.toHaveBeenCalled()
    expect(defs.length).toBeGreaterThan(0)
    expect(defs[0].method).toBe('POST')
  })

  it('자유형식 문서는 프록시(LLM)를 탄다', async () => {
    const callApiDocParse = vi.fn(async () => ({
      defs: [{ name: 'createOrder', method: 'POST' }],
    }))

    const { defs, source, error } = await extractApiDefsFromFile(txtFile(FREEFORM_DOC), {
      extractText: extractFileText,
      callApiDocParse,
    })

    expect(error).toBeNull()
    expect(source).toBe('llm')
    expect(callApiDocParse).toHaveBeenCalledTimes(1)
    // 프록시에는 추출된 텍스트가 그대로 전달돼야 한다
    expect(callApiDocParse).toHaveBeenCalledWith(FREEFORM_DOC)
    expect(defs).toEqual([{ name: 'createOrder', method: 'POST' }])
  })

  it('상류(파싱 서비스)가 죽어도 OpenAPI 경로는 계속 동작한다 — graceful degradation', async () => {
    // Task 6 라우터가 502를 던지는 상황을 클라이언트 관점에서 재현
    const callApiDocParse = vi.fn(async () => {
      throw new Error('자유형식 문서 추출에 실패했습니다. OpenAPI 파일은 계속 사용할 수 있습니다.')
    })

    const openapi = await extractApiDefsFromFile(jsonFile(OPENAPI_DOC), {
      extractText: extractFileText,
      callApiDocParse,
    })

    expect(openapi.error).toBeNull()
    expect(openapi.defs.length).toBeGreaterThan(0)
    expect(callApiDocParse).not.toHaveBeenCalled()
  })

  it('상류가 죽으면 자유형식 문서는 실패하고 사유가 전달된다', async () => {
    const callApiDocParse = vi.fn(async () => {
      throw new Error('자유형식 문서 추출에 실패했습니다. OpenAPI 파일은 계속 사용할 수 있습니다.')
    })

    // 던지지 않고 반환 계약으로 사유를 싣는다(상류 정책 — 예전엔 reject였다).
    const r = await extractApiDefsFromFile(txtFile(FREEFORM_DOC), {
      extractText: extractFileText,
      callApiDocParse,
    })
    expect(r.defs).toEqual([])
    expect(r.error).toMatch(/OpenAPI 파일은 계속 사용할 수 있습니다/)
    expect(callApiDocParse).toHaveBeenCalledTimes(1)
  })

  it('결정론 파서가 빈 결과를 내면 LLM으로 폴백한다', async () => {
    // OpenAPI로 분류되지만 paths가 비어 defs가 0인 문서 — 원본 로직의 폴백 분기
    const emptyOpenapi = JSON.stringify({ openapi: '3.0.0', paths: {} })
    expect(routeApiDoc(emptyOpenapi)).toBe('openapi')

    const callApiDocParse = vi.fn(async () => ({ defs: [{ name: 'fallback', method: 'GET' }] }))
    const { source, defs } = await extractApiDefsFromFile(jsonFile(emptyOpenapi), {
      extractText: extractFileText,
      callApiDocParse,
    })

    expect(callApiDocParse).toHaveBeenCalledTimes(1)
    expect(source).toBe('llm')
    expect(defs).toEqual([{ name: 'fallback', method: 'GET' }])
  })
})
