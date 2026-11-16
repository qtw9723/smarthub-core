// 컬럼별 샘플 값 수집 (순수 모듈, 파싱 라이브러리·UI 무의존).
// collectColumnSamples({ headers, rows }, limit, maxLen) → { [열]: string[] }
// 스키마 필드명·타입을 정할 때 "이 컬럼에 실제로 뭐가 들었는지" 보여주기 위함.

/**
 * @param {{ headers: string[], rows: Array<Record<string, string>> }} sheet
 * @param {number} [limit] 컬럼당 최대 샘플 개수
 * @param {number} [maxLen] 값 표시 최대 길이(초과 시 … 절단)
 * @returns {Record<string, string[]>}
 */
export function collectColumnSamples({ headers, rows }, limit = 3, maxLen = 20) {
  const result = {}
  for (const header of headers || []) {
    const seen = new Set()
    const samples = []
    for (const row of rows || []) {
      if (samples.length >= limit) break
      const value = String(row[header] ?? '').trim()
      if (value === '' || seen.has(value)) continue
      seen.add(value)
      samples.push(value.length > maxLen ? `${value.slice(0, maxLen)}…` : value)
    }
    result[header] = samples
  }
  return result
}
