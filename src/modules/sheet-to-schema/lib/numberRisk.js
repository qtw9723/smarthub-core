// number 타입 지정이 값을 망가뜨릴 위험을 감지한다 (순수 모듈, 파싱 라이브러리·UI 무의존).
// ③단계에서 "이 컬럼은 string이 안전합니다"를 알려주기 위한 것 — 자동으로 타입을 바꾸지는 않는다.

// 선행 0 (0123, 00456) — number로 올리면 앞자리 0이 사라진다.
const LEADING_ZERO_RE = /^[+-]?0\d/
// IEEE754 double이 정확히 표현하는 유효 자릿수 한계(2^53 ≈ 9.007e15 → 16자리부터 위험).
const SAFE_DIGITS = 15

/** 숫자 문자열의 유효 자릿수(부호·소수점·선행 0 제외) */
function significantDigits(value) {
  const digits = String(value).replace(/[+-]/g, '').replace(/\./g, '').replace(/^0+/, '')
  return digits.length
}

/**
 * 한 컬럼의 값들에서 number 위험을 찾는다.
 * @param {string[]} values 빈값이 제거된 문자열 값들
 * @returns {string[]} 사용자에게 보일 경고 문구(없으면 빈 배열)
 */
export function numberRisksOf(values) {
  const risks = []
  const leadingZero = (values || []).find((v) => LEADING_ZERO_RE.test(v))
  if (leadingZero) {
    risks.push(`선행 0이 사라집니다 (${leadingZero}) — string 권장`)
  }
  const tooLong = (values || []).find((v) => significantDigits(v) > SAFE_DIGITS)
  if (tooLong) {
    risks.push(`${significantDigits(tooLong)}자리 정수는 정밀도가 깨질 수 있습니다 (${tooLong}) — string 권장`)
  }
  return risks
}

/**
 * number로 지정된 컬럼들의 위험을 컬럼별로 모은다.
 * @param {{ headers?: string[], rows?: Array<Record<string, string>> }} sheet
 * @param {Record<string, { type?: string }>} fieldSpecs
 * @returns {Record<string, string[]>} 위험이 있는 컬럼만 담긴 맵
 */
export function detectNumberRisks({ headers = [], rows = [] }, fieldSpecs = {}) {
  const result = {}
  for (const header of headers) {
    if (fieldSpecs[header]?.type !== 'number') continue
    const values = rows.map((row) => String(row[header] ?? '').trim()).filter((v) => v !== '')
    const risks = numberRisksOf(values)
    if (risks.length > 0) result[header] = risks
  }
  return result
}
