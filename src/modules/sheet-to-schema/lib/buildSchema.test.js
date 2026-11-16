import { assertEquals , Deno } from './denoShim.js'
import { buildSchema } from "./buildSchema.js"

const SAMPLE = {
  schemaName: 'reservation',
  headers: ['예약번호', '고객명', '수량', 'createdAt'],
  fieldSpecs: {
    '예약번호': { type: 'string', key: true, crypt: 'false' },
    '고객명': { type: 'string', key: false, crypt: 'true' },
    '수량': { type: 'number', key: false, crypt: 'false' },
  },
  createdAt: '2026-07-23T00:00:00.000Z',
}

Deno.test('최상위 키 집합·순서가 생성기 SchemaDoc 계약과 일치', () => {
  const schema = buildSchema(SAMPLE)
  assertEquals(Object.keys(schema), [
    'name', 'description', 'tags', 'createdBy', 'createdAt',
    'fields', 'resultSamples', 'retentionPeriod', 'criteriaField',
  ])
})

Deno.test('필드 키 집합·순서가 생성기 SchemaField 계약과 일치', () => {
  const schema = buildSchema(SAMPLE)
  assertEquals(Object.keys(schema.fields[0]), [
    'readOnly', 'name', 'type', 'key', 'useSearch', 'crypt', 'description',
  ])
})

Deno.test('고정값이 생성기와 동일', () => {
  const schema = buildSchema(SAMPLE)
  assertEquals(schema.name, 'reservation')
  assertEquals(schema.description, '자동 생성된 스키마 (reservation)')
  assertEquals(schema.tags, '')
  assertEquals(schema.createdBy, 'sheet-to-schema')
  assertEquals(schema.createdAt, '2026-07-23T00:00:00.000Z')
  assertEquals(schema.resultSamples, [])
  assertEquals(schema.retentionPeriod, '')
  assertEquals(schema.criteriaField, 'updatedAt')
})

Deno.test('필드는 headers 순서를 보존하고 예약 타임스탬프 열은 제외', () => {
  const schema = buildSchema(SAMPLE)
  assertEquals(schema.fields.map((f) => f.name), ['예약번호', '고객명', '수량'])
})

Deno.test('필드 값이 스펙대로 매핑되고 readOnly·useSearch·description은 고정', () => {
  const schema = buildSchema(SAMPLE)
  assertEquals(schema.fields[0], {
    readOnly: false, name: '예약번호', type: 'string', key: true,
    useSearch: false, crypt: 'false', description: '',
  })
  assertEquals(schema.fields[1].crypt, 'true')
  assertEquals(schema.fields[2].type, 'number')
})

Deno.test('crypt는 불리언 입력도 문자열로 정규화', () => {
  const schema = buildSchema({
    ...SAMPLE,
    fieldSpecs: { '예약번호': { type: 'string', key: false, crypt: true } },
    headers: ['예약번호'],
  })
  assertEquals(schema.fields[0].crypt, 'true')
})

Deno.test('알 수 없는 타입·누락 스펙은 string으로 폴백', () => {
  const schema = buildSchema({
    ...SAMPLE,
    headers: ['이상한열', '스펙없는열'],
    fieldSpecs: { '이상한열': { type: 'date', key: false, crypt: 'false' } },
  })
  assertEquals(schema.fields[0].type, 'string')
  assertEquals(schema.fields[1], {
    readOnly: false, name: '스펙없는열', type: 'string', key: false,
    useSearch: false, crypt: 'false', description: '',
  })
})

Deno.test('key는 여러 개 지정할 수 있다 (복합키)', () => {
  const schema = buildSchema({
    ...SAMPLE,
    headers: ['a', 'b', 'c'],
    fieldSpecs: {
      a: { type: 'string', key: true, crypt: 'false' },
      b: { type: 'string', key: true, crypt: 'false' },
      c: { type: 'string', key: false, crypt: 'false' },
    },
  })
  assertEquals(schema.fields.map((f) => f.key), [true, true, false])
})

Deno.test('필드가 없으면 빈 배열', () => {
  const schema = buildSchema({ ...SAMPLE, headers: ['createdAt'], fieldSpecs: {} })
  assertEquals(schema.fields, [])
})
