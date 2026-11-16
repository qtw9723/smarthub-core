// 스키마 생성용 JSON 조립 (순수 모듈, 파싱 라이브러리·UI 무의존).
// 산출 형식은 생성기(대상 생성기의 스키마 도출 코드)의
// SchemaDoc / SchemaField와 키 집합·순서·값 형식이 동일해야 한다.

import { isReservedTimestampColumn } from './uploadCsvRules.js'
import { FIELD_TYPES } from './schemaFieldRules.js'

/**
 * @param {{
 *   schemaName: string,
 *   headers: string[],
 *   fieldSpecs: Record<string, { type?: string, key?: boolean, crypt?: string|boolean }>,
 *   createdAt: string,
 * }} param
 * @returns {object} SchemaDoc
 */
export function buildSchema({ schemaName, headers, fieldSpecs, createdAt }) {
  const specs = fieldSpecs || {}

  const fields = (headers || [])
    .filter((h) => !isReservedTimestampColumn(h))
    .map((name) => {
      const spec = specs[name] || {}
      return {
        readOnly: false,
        name,
        type: FIELD_TYPES.includes(spec.type) ? spec.type : 'string',
        // 스키마는 복합키를 허용한다 — 스펙의 key를 그대로 반영한다(개수 제한 없음).
        key: spec.key === true,
        useSearch: false,
        crypt: spec.crypt === 'true' || spec.crypt === true ? 'true' : 'false',
        description: '',
      }
    })

  return {
    name: schemaName,
    description: `자동 생성된 스키마 (${schemaName})`,
    tags: '',
    createdBy: 'sheet-to-schema',
    createdAt,
    fields,
    resultSamples: [],
    retentionPeriod: '',
    criteriaField: 'updatedAt',
  }
}
