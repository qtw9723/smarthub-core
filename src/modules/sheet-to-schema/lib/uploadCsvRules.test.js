import { assertEquals , Deno } from './denoShim.js'
import {
  DELIMITER,
  LINE_ENDING,
  HAS_HEADER,
  INCLUDE_BOM,
  ENCODING,
  AUTO_APPEND_COLUMNS,
  isReservedTimestampColumn,
  serializeCell,
} from "./uploadCsvRules.js"

Deno.test('상수: 구분자·개행·헤더 정책 확인', () => {
  assertEquals(DELIMITER, ',')
  assertEquals(LINE_ENDING, '\n')
  assertEquals(HAS_HEADER, true)
})

Deno.test('상수: 인코딩·BOM 정책 확인', () => {
  assertEquals(INCLUDE_BOM, false)
  assertEquals(ENCODING, 'utf-8')
})

Deno.test('상수: 자동 추가 컬럼은 createdAt·updatedAt 순서', () => {
  assertEquals(AUTO_APPEND_COLUMNS, ['createdAt', 'updatedAt'])
})

Deno.test('isReservedTimestampColumn: 정확한 이름 판정', () => {
  assertEquals(isReservedTimestampColumn('createdAt'), true)
  assertEquals(isReservedTimestampColumn('updatedAt'), true)
  assertEquals(isReservedTimestampColumn('created_at'), true)
  assertEquals(isReservedTimestampColumn('updated_at'), true)
})

Deno.test('isReservedTimestampColumn: 대소문자 무시', () => {
  assertEquals(isReservedTimestampColumn('CreatedAt'), true)
  assertEquals(isReservedTimestampColumn('CREATEDAT'), true)
  assertEquals(isReservedTimestampColumn('UpdatedAt'), true)
  assertEquals(isReservedTimestampColumn('UPDATED_AT'), true)
  assertEquals(isReservedTimestampColumn('Created_At'), true)
})

Deno.test('isReservedTimestampColumn: 일반 열 이름은 false', () => {
  assertEquals(isReservedTimestampColumn('name'), false)
  assertEquals(isReservedTimestampColumn('number'), false)
  assertEquals(isReservedTimestampColumn('string'), false)
  assertEquals(isReservedTimestampColumn('id'), false)
  assertEquals(isReservedTimestampColumn(''), false)
})

Deno.test('serializeCell: number 타입은 무따옴표', () => {
  assertEquals(serializeCell('42', 'number'), '42')
  assertEquals(serializeCell('3.14', 'number'), '3.14')
  assertEquals(serializeCell('0', 'number'), '0')
})

Deno.test('serializeCell: string 타입은 따옴표로 감쌈', () => {
  assertEquals(serializeCell('hello', 'string'), '"hello"')
  assertEquals(serializeCell('string6', 'string'), '"string6"')
  assertEquals(serializeCell('0101234', 'string'), '"0101234"')
})

Deno.test('serializeCell: 내부 따옴표 RFC4180 이스케이프("")', () => {
  assertEquals(serializeCell('a"b', 'string'), '"a""b"')
  assertEquals(serializeCell('say "hi"', 'string'), '"say ""hi"""')
})

Deno.test('serializeCell: 쉼표 포함 값은 따옴표로 감쌈', () => {
  assertEquals(serializeCell('a,b', 'string'), '"a,b"')
})
