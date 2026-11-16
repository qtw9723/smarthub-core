import { extractApiDefsFromText } from './extractApiDefs.js'

/**
 * API 문서 **파일**에서 api_def 배열을 추출한다.
 * 이 함수의 몫은 "파일 → 텍스트"까지고, 그 뒤는 붙여넣기와 **같은 경로**를 쓴다
 * (extractApiDefsFromText). 두 입력이 다른 구현을 갖고 있던 것이 배지 누락의 원인이었다.
 *
 * @param {File} file
 * @param {{ callApiDocParse: (text: string) => Promise<{defs: any[]}>, extractText: (file: File) => Promise<string> }} deps
 * @returns {Promise<{ defs: any[], source: 'openapi'|'llm'|null, error: string|null }>}
 */
export async function extractApiDefsFromFile(file, { callApiDocParse, extractText }) {
  let text
  try {
    text = await extractText(file)
  } catch (err) {
    // `??`가 아니라 `||` — message가 빈 문자열인 Error도 있고, 그러면 호출부가
    // "오류 없음"으로 읽어 아무 설명 없이 넘어간다.
    return { defs: [], source: null, error: err?.message || '텍스트 추출에 실패했습니다.' }
  }
  return extractApiDefsFromText(text, { callApiDocParse })
}
