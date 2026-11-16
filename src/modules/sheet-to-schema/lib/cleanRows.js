// 스키마 업로드 데이터 정제 (순수 모듈, 파싱 라이브러리·UI 무의존).
// applyFieldSelection 이후 · excelToUploadCsv 이전에 실행해 "정상 규격"에 맞게 값을 정리한다.
// - 항상: 셀 값 앞뒤 공백 트림, 완전히 빈 행 제거.
// - 검증: number 타입 컬럼의 비-숫자 값(빈값 제외)을 errors로 표시(미리보기 하이라이트용).
// - 선택(opt-in): 숫자 포맷 정규화 / 날짜 정규화(YYYY-MM-DD) / 불린 정규화(→ "true"/"false").
//   → 자동 변형은 오해 소지가 있어 사용자가 켤 때만 적용한다.
// - 경고(warnings): boolean·geo 타입 컬럼의 값이 그 타입 표기가 아닐 때. 값은 건드리지
//   않고 알리기만 한다(스키마 업로드에서 터지기 전에 미리보기에서 보이게).

import { isNumericValue } from './inferColumnTypes.js'
import { trimCell } from './normalizeSheet.js'

// 천단위 콤마·통화기호·공백 (숫자 포맷 정규화 시 제거 대상)
const NUMERIC_NOISE = /[₩$€£¥,\s]/g

/**
 * 순수 숫자 문자열인지(부호·소수점·지수표기 허용, 빈값 아님).
 * ⚠ 판정 기준은 inferColumnTypes와 공유한다 — 따로 두면 "타입은 number인데
 * 검증은 숫자가 아니라고 하는" 자기모순이 생긴다(지수표기 1E+15 실제 사례).
 */
export function isNumericString(v) {
  return typeof v === 'string' && isNumericValue(v)
}

/** 천단위 콤마·통화기호·공백을 걷어내고 유효 숫자면 정리값, 아니면 원본 유지(날조 방지) */
export function normalizeNumberValue(v) {
  const stripped = v.replace(NUMERIC_NOISE, '')
  return isNumericString(stripped) ? stripped : v
}

const TRUE_TOKENS = new Set(['true', 'y', 'yes', '예', '참', 'o', 'on', '1'])
const FALSE_TOKENS = new Set(['false', 'n', 'no', '아니오', '아니요', '거짓', 'x', 'off', '0'])

/** 예/아니오·Y/N·true/false 등을 "true"/"false"로. 인식 못 하면 null(변경 안 함) */
export function normalizeBooleanValue(v) {
  const k = v.trim().toLowerCase()
  if (TRUE_TOKENS.has(k)) return 'true'
  if (FALSE_TOKENS.has(k)) return 'false'
  return null
}

/** YYYY-MM-DD / YYYY/MM/DD / YYYY.MM.DD / YYYYMMDD → YYYY-MM-DD(zero-pad). 그 외 null(변경 안 함) */
export function normalizeDateValue(v) {
  let m = v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/)
  if (!m) {
    const c = v.match(/^(\d{4})(\d{2})(\d{2})$/)
    if (c) m = c
  }
  if (!m) return null
  const [, y, mo, d] = m
  const mm = String(mo).padStart(2, '0')
  const dd = String(d).padStart(2, '0')
  if (+mm < 1 || +mm > 12 || +dd < 1 || +dd > 31) return null
  return `${y}-${mm}-${dd}`
}

/** 스키마 boolean 컬럼에 그대로 올려도 되는 표기인가 ("true"/"false"만) */
function isCanonicalBoolean(v) {
  const k = v.trim().toLowerCase()
  return k === 'true' || k === 'false'
}

/** 스키마 geo 컬럼 표기인가 — 숫자 하나 또는 "위도, 경도" */
function isGeoValue(v) {
  const parts = v.split(',').map((p) => p.trim())
  if (parts.length > 2) return false
  return parts.every((p) => isNumericValue(p))
}

/**
 * 정규화된 { headers, rows, columnTypes }를 규격에 맞게 정제한다.
 * @param {{ headers?: string[], rows?: Array<Record<string, string>>, columnTypes?: Record<string, 'number'|'string'>, fieldTypes?: Record<string, 'string'|'number'|'boolean'|'geo'> }} sheet
 * @param {{ trim?: boolean, dropEmptyRows?: boolean, normalizeNumbers?: boolean, normalizeDates?: boolean, normalizeBooleans?: boolean }} [options]
 * @returns {{ headers: string[], rows: Array<Record<string,string>>, errors: Array<{row:number,column:string,message:string}>, warnings: Array<{row:number,column:string,message:string}>, stats: {removedEmpty:number,trimmedCells:number,normalizedCells:number,total:number} }}
 */
export function cleanRows({ headers = [], rows = [], columnTypes = {}, fieldTypes = {} }, options = {}) {
  const {
    trim = true,
    dropEmptyRows = true,
    normalizeNumbers = false,
    normalizeDates = false,
    normalizeBooleans = false,
  } = options

  const errors = []
  const warnings = []
  const outRows = []
  let removedEmpty = 0
  let trimmedCells = 0
  let normalizedCells = 0

  for (const row of rows) {
    const cleaned = {}
    let allEmpty = true

    for (const h of headers) {
      let v = row[h] == null ? '' : String(row[h])

      if (trim) {
        // 제로폭 공백 등 보이지 않는 문자까지 제거한다(빈 것처럼 보이는 셀·행을 남기지 않도록).
        const t = trimCell(v)
        if (t !== v) trimmedCells++
        v = t
      }

      if (v !== '') {
        const type = columnTypes[h]
        let nv = v
        // 숫자 정규화는 number 컬럼에만
        if (normalizeNumbers && type === 'number') nv = normalizeNumberValue(nv)
        // 불린·날짜 정규화는 number 컬럼 제외(1/0 등 숫자 오변환 방지)
        if (type !== 'number') {
          if (normalizeBooleans) {
            const b = normalizeBooleanValue(nv)
            if (b !== null) nv = b
          }
          if (normalizeDates) {
            const d = normalizeDateValue(nv)
            if (d !== null) nv = d
          }
        }
        if (nv !== v) normalizedCells++
        v = nv
      }

      cleaned[h] = v
      if (v !== '') allEmpty = false
    }

    if (dropEmptyRows && allEmpty) {
      removedEmpty++
      continue
    }

    // 검증: number 컬럼의 비-숫자 값(빈값 제외) → 오류 표시(정제 후 행 인덱스 기준)
    // 경고: boolean·geo 컬럼의 표기 불일치 — 값은 그대로 두고 알리기만 한다.
    const outIdx = outRows.length
    for (const h of headers) {
      const value = cleaned[h]
      if (value === '') continue
      if (columnTypes[h] === 'number' && !isNumericString(value)) {
        errors.push({ row: outIdx, column: h, message: `숫자 형식이 아닙니다: "${value}"` })
        continue
      }
      const fieldType = fieldTypes[h]
      if (fieldType === 'boolean' && !isCanonicalBoolean(value)) {
        warnings.push({
          row: outIdx,
          column: h,
          message: `boolean 컬럼인데 true/false가 아닙니다: "${value}" — 불린 정규화를 켜거나 타입을 바꾸세요.`,
        })
      } else if (fieldType === 'geo' && !isGeoValue(value)) {
        warnings.push({
          row: outIdx,
          column: h,
          message: `geo 컬럼인데 좌표 표기가 아닙니다: "${value}" — 위도/경도 숫자 또는 "위도, 경도" 형식이어야 합니다.`,
        })
      }
    }
    outRows.push(cleaned)
  }

  return {
    headers,
    rows: outRows,
    errors,
    warnings,
    stats: { removedEmpty, trimmedCells, normalizedCells, total: outRows.length },
  }
}
