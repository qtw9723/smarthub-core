import { parse as parseYaml } from 'yaml'
import { apiDocToDef } from './apiDocToDef.js'

// OpenAPI 3.x 문서(JSON 또는 YAML 문자열)를 api_def 배열로 변환하는 공용 모듈.
// 관리자 API 레퍼런스 페이지와 "문서 → API 생성" 부가 도구 페이지가 함께 사용한다(복붙 금지).
// 순수 함수 — UI 상태에 의존하지 않고 { defs, error }를 돌려준다.
//   성공: { defs: [api_def, ...], error: '' }
//   실패: { defs: [], error: '사람이 읽을 수 있는 사유' }
export function parseApiDocToDefs(raw) {
  if (!raw || !raw.trim()) {
    return { defs: [], error: '문서를 붙여넣거나 파일을 업로드하세요.' }
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    try {
      parsed = parseYaml(raw)
    } catch {
      return { defs: [], error: '지원 포맷 아님: JSON 또는 YAML 파싱에 실패했습니다.' }
    }
  }
  if (!parsed || typeof parsed !== 'object' || typeof parsed.openapi !== 'string') {
    return { defs: [], error: '지원 포맷 아님: OpenAPI 3.x 문서가 아닙니다.' }
  }
  const defs = apiDocToDef(parsed)
  if (defs.length === 0) {
    return { defs: [], error: '파싱 결과가 없습니다. paths가 비어 있거나 지원 포맷 아님.' }
  }
  return { defs, error: '' }
}
