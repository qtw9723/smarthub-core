// 컬럼 타입 추론 (순수 모듈, 파싱 라이브러리·UI 무의존).
// inferColumnTypes({ headers, rows }) → Record<header, 'number' | 'string'>

// 정수·소수·부호·지수표기 허용. 선행 0(0101234)은 number로 판정(R2 UI에서 교정 가능).
// ⚠ 이 판정이 number 타입의 유일한 기준이다 — 정제·검증(cleanRows)도 이 함수를 쓴다.
// (예전엔 cleanRows가 지수표기를 모르는 별도 정규식을 써서 "타입 number인데
//  숫자 형식이 아닙니다" 자기모순 오류가 났다.)
const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/

/** 숫자로 볼 수 있는 문자열인가 (빈 문자열은 false) */
export function isNumericValue(value) {
  return value !== '' && NUMBER_RE.test(String(value ?? ''))
}

/**
 * 엑셀에서 정규화된 { headers, rows }를 받아 컬럼별 타입을 추론한다.
 * - 값이 있는 셀이 전부 숫자면 'number', 하나라도 비숫자면 'string'.
 * - 빈 컬럼(값 있는 셀 없음)은 'string' (안전 기본값).
 * - 빈칸 셀은 판정에서 스킵.
 * @param {{ headers: string[], rows: Record<string, string>[] }} param
 * @returns {Record<string, 'number' | 'string'>}
 */
export function inferColumnTypes({ headers, rows }) {
  const result = {}
  for (const header of headers) {
    const nonEmpty = rows.map(row => row[header] ?? '').filter(v => v !== '')
    if (nonEmpty.length === 0) {
      result[header] = 'string'
    } else {
      result[header] = nonEmpty.every(isNumericValue) ? 'number' : 'string'
    }
  }
  return result
}
