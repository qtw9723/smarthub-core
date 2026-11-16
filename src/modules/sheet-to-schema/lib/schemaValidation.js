// 스키마 저장 전 검증 (순수 모듈, UI·파싱 라이브러리 무의존).
// R6/AC7: 차단 규칙 위반 시 사유 문자열 반환, 통과 시 null.

import { isReservedTimestampColumn } from './uploadCsvRules.js'

// 스키마명 권장 표기 — 영문으로 시작하는 영문·숫자·_ 조합.
const SCHEMA_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * 스키마명이 권장 표기를 벗어나면 경고 문구, 문제 없으면 null.
 * ⚠ 차단이 아니라 경고다 — 스키마가 실제로 무엇을 받아주는지는 스키마 쪽 규칙이므로,
 * 파일명이 그대로 스키마명이 되어 한글·공백·괄호가 들어가는 상황만 알린다.
 * @param {string} name
 * @returns {string | null}
 */
export function schemaNameWarning(name) {
  const trimmed = String(name ?? '').trim()
  if (trimmed === '') return null
  if (SCHEMA_NAME_RE.test(trimmed)) return null
  return '스키마명은 영문으로 시작하는 영문·숫자·_ 조합을 권장합니다 — 한글·공백·특수문자는 스키마 등록에서 거부될 수 있습니다.'
}

/**
 * 에디터 엔티티 배열을 검증한다.
 * 위반 시 한국어 사유 문자열, 통과 시 null.
 *
 * @param {Array<{
 *   schemaName: string,
 *   fields: Array<{ name: string }>,
 * }>} entities
 * @returns {string | null}
 */
export function validateSchemaDraft(entities) {
  if (!entities || entities.length === 0) {
    return '스키마가 1개 이상 있어야 합니다.'
  }

  for (const entity of entities) {
    const name = (entity.schemaName || '').trim()
    if (!name) {
      return '스키마 이름이 비어 있습니다. 모든 스키마에 이름을 입력하세요.'
    }

    const fields = entity.fields || []
    const seenNames = new Set()

    for (const field of fields) {
      const fieldName = (field.name || '').trim()
      if (!fieldName) {
        return `스키마 "${name}"에 빈 필드명이 있습니다. 모든 필드에 이름을 입력하세요.`
      }
      if (isReservedTimestampColumn(fieldName)) {
        return `스키마 "${name}"의 필드명 "${field.name}"은 예약된 타임스탬프 열입니다(createdAt/updatedAt 계열은 사용할 수 없습니다).`
      }
      if (seenNames.has(fieldName)) {
        return `스키마 "${name}"에 중복된 필드명 "${fieldName}"이 있습니다.`
      }
      seenNames.add(fieldName)
    }
  }

  return null
}
