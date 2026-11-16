// 엑셀 시트 데이터에서 스키마 필드 속성(type·key·crypt)을 판정한다 (순수 모듈).
// inferSchemaFields({ headers, rows }) → { [열]: { type, key, crypt } }
// 예약 타임스탬프 열(createdAt/updatedAt 계열)은 스키마가 관리하므로 결과에서 제외한다.

import { inferColumnTypes } from './inferColumnTypes.js'
import { isReservedTimestampColumn } from './uploadCsvRules.js'
import {
  isGeoName,
  isBooleanName,
  isForceStringName,
  isPiiName,
  isKeyCandidateName,
  isBooleanValue,
} from './schemaFieldRules.js'

function nonEmptyValues(rows, header) {
  return rows.map((row) => row[header] ?? '').filter((v) => v !== '')
}

// 판정 우선순위: geo → boolean → string 강제 → number → string
function inferType(header, rows, numericTypes) {
  if (isGeoName(header)) return 'geo'
  if (isBooleanName(header)) return 'boolean'
  const values = nonEmptyValues(rows, header)
  if (values.length > 0 && values.every(isBooleanValue)) return 'boolean'
  if (isForceStringName(header)) return 'string'
  return numericTypes[header] === 'number' ? 'number' : 'string'
}

// 값이 전부 채워져 있고 전부 고유한가 (식별자 후보 검증)
function hasUniqueValues(rows, header) {
  if (rows.length === 0) return false
  const values = rows.map((row) => row[header] ?? '')
  if (values.some((v) => v === '')) return false
  return new Set(values).size === values.length
}

/**
 * @param {{ headers: string[], rows: Array<Record<string, string>> }} sheet
 * @returns {Record<string, { type: 'string'|'number'|'boolean'|'geo', key: boolean, crypt: 'true'|'false' }>}
 */
export function inferSchemaFields({ headers, rows }) {
  const targets = (headers || []).filter((h) => !isReservedTimestampColumn(h))
  const numericTypes = inferColumnTypes({ headers: targets, rows: rows || [] })

  const specs = {}
  for (const header of targets) {
    specs[header] = {
      type: inferType(header, rows || [], numericTypes),
      key: false,
      crypt: isPiiName(header) ? 'true' : 'false',
    }
  }

  // 자동 판정은 보수적으로 하나만 잡는다(스키마는 복합키를 허용하므로 추가 지정은 사용자 몫).
  // 이름이 식별자 패턴이고, 개인정보가 아니고, 값이 전부 고유한 첫 열.
  const keyHeader = targets.find(
    (h) => isKeyCandidateName(h) && specs[h].crypt === 'false' && hasUniqueValues(rows || [], h),
  )
  if (keyHeader) specs[keyHeader].key = true

  return specs
}
