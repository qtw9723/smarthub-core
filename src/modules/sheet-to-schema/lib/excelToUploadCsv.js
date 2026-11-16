// 스키마 업로드용 CSV 생성 (순수 모듈, 파싱 라이브러리·UI 무의존).
// excelToUploadCsv({ headers, rows, columnTypes }, rules?) → { csv: string, errors: [] }
// rules 기본값 = uploadCsvRules(T1).

import {
  DELIMITER,
  LINE_ENDING,
  AUTO_APPEND_COLUMNS,
  isReservedTimestampColumn,
  serializeCell,
  serializeHeader,
} from './uploadCsvRules.js'

const defaultRules = { DELIMITER, LINE_ENDING, AUTO_APPEND_COLUMNS, isReservedTimestampColumn, serializeCell, serializeHeader }

/**
 * 정규화된 { headers, rows, columnTypes }를 스키마 업로드용 CSV 문자열로 변환한다.
 * - 제외: createdAt/updatedAt 계열 열(대소문자·snake 무시)
 * - 추가: 맨 끝에 AUTO_APPEND_COLUMNS(createdAt, updatedAt), 값은 항상 빈칸
 * - 직렬화: columnType === 'number' → 무따옴표, 그 외 → RFC4180 따옴표·이스케이프
 * @param {{ headers: string[], rows: Record<string, string>[], columnTypes: Record<string, 'number'|'string'> }} param
 * @param {typeof defaultRules} [rules]
 * @returns {{ csv: string, errors: Array<{row: number, column: string, message: string}> }}
 */
export function excelToUploadCsv({ headers, rows, columnTypes }, rules = defaultRules) {
  const filteredHeaders = headers.filter(h => !rules.isReservedTimestampColumn(h))
  const outputHeaders = [...filteredHeaders, ...rules.AUTO_APPEND_COLUMNS]

  const lines = []
  lines.push(outputHeaders.map((h) => (rules.serializeHeader ?? String)(h)).join(rules.DELIMITER))

  for (const row of rows) {
    const cells = []
    for (const header of filteredHeaders) {
      const value = row[header] ?? ''
      const colType = columnTypes[header] ?? 'string'
      cells.push(rules.serializeCell(value, colType))
    }
    for (let i = 0; i < rules.AUTO_APPEND_COLUMNS.length; i++) {
      cells.push('')
    }
    lines.push(cells.join(rules.DELIMITER))
  }

  return {
    csv: lines.join(rules.LINE_ENDING) + rules.LINE_ENDING,
    errors: [],
  }
}
