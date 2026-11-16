// 시트 2D 배열 정규화 (순수 모듈, 파싱 라이브러리 무의존).
// normalizeSheetData(rawData, options) → { headers, rows, headerSources, headerRow }
//
// ⚠ 헤더 키는 반드시 유일해야 한다 — rows가 Record<헤더, 값>이므로 헤더가 겹치면
// 뒤 열이 앞 열을 덮어써 데이터가 조용히 사라진다(중복 헤더·빈 헤더·병합 헤더 시트).
// 그래서 트림·빈 헤더 이름 부여·중복 접미(_2) 처리를 파싱 경계에서 끝낸다.

// 보이지 않는 문자(제로폭 공백·BOM 등) — 트림 대상. 눈에 안 보이므로 값이 있는 것처럼
// 판정되어 "빈 행 제거"·빈 헤더 판정을 빠져나가는 사고를 막는다.
const INVISIBLE_RE = /[\u200B-\u200D\u2060\uFEFF]/g

/** 앞뒤 공백 + 보이지 않는 문자를 제거한다. */
export function trimCell(value) {
  return String(value ?? '').replace(INVISIBLE_RE, '').trim()
}

/**
 * 헤더 행 문자열 배열 → 유일한 헤더 키 배열.
 * - 트림(보이지 않는 문자 포함)
 * - 빈 헤더 → `열${표시순서}` (⚠ 엑셀 열문자가 아니라 빈 열 제거 후 표시 순서 기준)
 * - 중복 → `이름_2`, `이름_3` … (이미 쓰인 이름과 겹치지 않을 때까지)
 * @param {Array<unknown>} rawHeaders
 * @returns {string[]}
 */
export function resolveHeaderKeys(rawHeaders) {
  const used = new Set()
  return (rawHeaders || []).map((raw, i) => {
    // 헤더 안의 개행·탭은 공백 하나로 접는다 — 그대로 두면 CSV 헤더 줄이 쪼개지고
    // 스키마 필드명으로도 쓸 수 없다(엑셀에서 Alt+Enter로 줄바꿈한 헤더가 흔하다).
    const base = trimCell(raw).replace(/\s+/g, ' ') || `열${i + 1}`
    let key = base
    let n = 2
    while (used.has(key)) key = `${base}_${n++}`
    used.add(key)
    return key
  })
}

/** 행에서 값이 있는 셀 개수 */
function filledCount(row) {
  return (row || []).reduce((n, cell) => (trimCell(cell) !== '' ? n + 1 : n), 0)
}

// 1행이 헤더가 아니라고 볼 최대 비율 — 1행이 최대 채움의 이 비율보다 훨씬 적게
// 채워져 있을 때만 "제목 행"으로 보고 아래로 내려간다.
const TITLE_ROW_FILL_RATIO = 0.6

/**
 * 헤더 행 위치를 추정한다 (제목·작성자 등 머리글이 앞에 붙은 실무 문서 대응).
 * 기본은 0행이다. 0행이 아래 행들보다 확연히 덜 채워져 있을 때만(제목 행 형태)
 * "값이 있는 셀이 가장 많은" 첫 행으로 내려간다.
 * ⚠ 보수적으로 판단해야 한다 — 열이 다 채워진 정상 시트에서 데이터 행을 헤더로
 * 잘못 고르면 1행이 통째로 사라진다(02 QA 파일 실제 사례).
 * @param {Array<Array<unknown>>} rawData
 * @param {number} [scanRows] 앞에서 몇 행까지 볼지
 * @returns {number} 헤더로 쓸 행 인덱스
 */
export function detectHeaderRow(rawData, scanRows = 10) {
  if (!Array.isArray(rawData) || rawData.length === 0) return 0
  const counts = rawData.slice(0, scanRows).map(filledCount)
  const max = Math.max(...counts)
  if (max < 2) return 0
  // 0행이 충분히 채워져 있으면 그대로 헤더로 본다.
  if (counts[0] >= max * TITLE_ROW_FILL_RATIO) return 0
  const idx = counts.indexOf(max)
  // 헤더 아래에 데이터가 한 행도 없으면 헤더로 볼 수 없다.
  return idx > 0 && idx < rawData.length - 1 ? idx : 0
}

/**
 * 시트 raw 2D 배열을 { headers, rows }로 정규화한다.
 * - 헤더 행 = options.headerRow (기본 0, 'auto'면 detectHeaderRow로 추정)
 * - 헤더 행 위쪽 행은 버린다(제목·작성자 등)
 * - 완전 빈 열(헤더 행 이하 모든 행이 빈칸) 제거
 * - 완전 빈 행 제거
 * - 헤더 키는 유일하게 보정(resolveHeaderKeys)
 * @param {Array<Array<unknown>>} rawData row-major 2D 배열
 * @param {{ headerRow?: number|'auto' }} [options]
 * @returns {{ headers: string[], rows: Array<Record<string, string>>, headerSources: string[], headerRow: number }}
 */
export function normalizeSheetData(rawData, options = {}) {
  const empty = { headers: [], rows: [], headerSources: [], headerRow: 0 }
  if (!rawData || rawData.length === 0) return empty

  const stringRows = rawData.map(row =>
    Array.isArray(row) ? row.map(cell => String(cell ?? '')) : []
  )

  const requested = options.headerRow ?? 0
  const headerRow = requested === 'auto'
    ? detectHeaderRow(stringRows)
    : Math.min(Math.max(Number(requested) || 0, 0), Math.max(stringRows.length - 1, 0))

  const scoped = stringRows.slice(headerRow)
  if (scoped.length === 0) return empty

  const maxCols = Math.max(...scoped.map(r => r.length), 0)

  // 완전 빈 열 인덱스 마스크 (헤더 행 이하 어느 행이든 값 있으면 살림)
  const keepCol = Array.from({ length: maxCols }, (_, ci) =>
    scoped.some(row => trimCell(row[ci]) !== '')
  )

  const filteredRows = scoped.map(row =>
    keepCol.map((keep, ci) => (keep ? (row[ci] ?? '') : null)).filter(v => v !== null)
  )

  if (filteredRows.length === 0) return empty

  const headerSources = filteredRows[0]
  const headers = resolveHeaderKeys(headerSources)
  const dataRows = filteredRows.slice(1)

  // 완전 빈 행 제거
  const nonEmptyRows = dataRows.filter(row => row.some(cell => trimCell(cell) !== ''))

  const rows = nonEmptyRows.map(row => {
    const record = {}
    for (let i = 0; i < headers.length; i++) {
      record[headers[i]] = row[i] ?? ''
    }
    return record
  })

  return { headers, rows, headerSources, headerRow }
}
