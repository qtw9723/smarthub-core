/**
 * API 문서 텍스트를 OpenAPI 구조 문서인지 자유형 텍스트인지 판별한다.
 * 무거운 YAML 파서 없이 문자열 접두·JSON 루트 검사만 수행한다.
 * @param {string} text
 * @returns {'openapi' | 'freeform'}
 */
export function routeApiDoc(text) {
  if (!text || !text.trim()) return 'freeform'

  const trimmed = text.trim()

  // JSON 루트 검사: openapi·swagger·paths 키가 루트에 있으면 OpenAPI
  if (trimmed.startsWith('{')) {
    try {
      const obj = JSON.parse(trimmed)
      if (obj && typeof obj === 'object' && ('openapi' in obj || 'swagger' in obj || 'paths' in obj)) {
        return 'openapi'
      }
    } catch {
      // JSON 파싱 실패 — YAML 접두 검사로 이어서
    }
  }

  // YAML 접두 검사: 첫 200자에서 openapi: 또는 swagger: 로 시작하는 줄
  if (/^\s*(openapi|swagger)\s*:/m.test(trimmed.slice(0, 200))) {
    return 'openapi'
  }

  return 'freeform'
}
