// 스키마 업로드 CSV 변환 정책 상수 (순수 모듈, 파싱 라이브러리·UI 무의존).
// excelToUploadCsv(T3)가 이 상수를 주입받아 결정론적으로 변환한다.

export const DELIMITER = ','

export const LINE_ENDING = '\n'

export const HAS_HEADER = true

// BOM 없음 — Excel UTF-8 CSV는 BOM을 붙이는 경우가 있으나 스키마 업로드는 BOM 없음이 사양.
export const INCLUDE_BOM = false

export const ENCODING = 'utf-8'

// 맨 끝에 자동 추가되는 컬럼명 (값은 항상 빈칸)
export const AUTO_APPEND_COLUMNS = ['createdAt', 'updatedAt']

// 엑셀 열에서 제외할 이름 집합 (대소문자 무시 — isReservedTimestampColumn으로 판정).
// camelCase→lowercase('createdat','updatedat')와 snake_case('created_at','updated_at') 양쪽 포함.
const RESERVED_TIMESTAMP_NAMES = new Set([
  'createdat',
  'updatedat',
  'created_at',
  'updated_at',
])

/**
 * 열 이름이 createdAt/updatedAt 계열(대소문자·snake 무시)인지 판정한다.
 * @param {string} name
 * @returns {boolean}
 */
export function isReservedTimestampColumn(name) {
  return RESERVED_TIMESTAMP_NAMES.has(name.toLowerCase())
}

/**
 * 값을 RFC4180 CSV 셀로 직렬화한다.
 * - columnType === 'number': 무따옴표
 * - 그 외: `"` 로 감쌈, 내부 `"` → `""`
 * @param {string} value
 * @param {'number'|'string'} columnType
 * @returns {string}
 */
export function serializeCell(value, columnType) {
  if (columnType === 'number') return value
  return '"' + value.replace(/"/g, '""') + '"'
}

/**
 * 헤더 이름을 CSV 헤더 셀로 직렬화한다.
 * 평소엔 무따옴표(기존 사양 유지). 구분자·따옴표·개행이 들어 있을 때만 감싼다 —
 * 감싸지 않으면 헤더 줄이 쪼개져 CSV 구조 자체가 깨진다(엑셀 줄바꿈 헤더 실제 사례).
 * @param {string} name
 * @returns {string}
 */
export function serializeHeader(name) {
  const text = String(name ?? '')
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text
}
