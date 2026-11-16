// 문서 텍스트 → api_def 배열. **붙여넣기와 파일 업로드가 함께 쓰는 단일 경로.**
//
// 예전에는 붙여넣기가 HubPanel 안에서 따로 파싱했다. 그래서 같은 문서라도 파일로 올리면
// 추출 방식 배지("OpenAPI 결정론" / "문서(LLM)")가 뜨고 붙여넣으면 뜨지 않았다.
// 구현이 둘이면 한쪽만 고치는 드리프트도 생긴다 — 여기 하나만 둔다.
import { routeApiDoc } from './routeApiDoc.js'
import { parseApiDocToDefs } from './parseApiDoc.js'

/**
 * @param {string} text
 * @param {{ callApiDocParse: (text: string) => Promise<{defs: any[]}> }} deps
 * @returns {Promise<{ defs: any[], source: 'openapi'|'llm'|null, error: string|null }>}
 */
export async function extractApiDefsFromText(text, { callApiDocParse }) {
  const trimmed = typeof text === 'string' ? text.trim() : ''
  if (!trimmed) {
    return { defs: [], source: null, error: '문서를 붙여넣거나 파일을 업로드하세요.' }
  }

  // 결정론 우선. routeApiDoc이 'openapi'로 봐도 결정론 파서는 OpenAPI 3.x만 받으므로
  // (swagger 2.0 등) 비면 LLM으로 떨어진다.
  if (routeApiDoc(trimmed) === 'openapi') {
    const { defs, error } = parseApiDocToDefs(trimmed)
    if (!error && defs.length > 0) return { defs, source: 'openapi', error: null }
  }

  // ⚠ LLM 호출이 던져도 여기서 잡아 반환 계약({defs, source, error})으로 돌려준다
  //    (상류 정책). 상류는 파일마다 Promise.all로 돌려 한 건의 429가 전체를
  //    멈췄다. 우리 호출부는 단건이라 그 피해는 없지만, `/parse`엔 시간당 상한(429)이 있고
  //    계약이 "던지지 않는다"여야 호출부가 늘어도 같은 사고가 나지 않는다.
  let result
  try {
    result = await callApiDocParse(trimmed)
  } catch (err) {
    return { defs: [], source: 'llm', error: err?.message || 'API 문서를 읽지 못했습니다.' }
  }
  const llmDefs = Array.isArray(result?.defs) ? result.defs : []
  if (llmDefs.length === 0) {
    return { defs: [], source: 'llm', error: '문서에서 API 정의를 추출하지 못했습니다.' }
  }
  return { defs: llmDefs, source: 'llm', error: null }
}
