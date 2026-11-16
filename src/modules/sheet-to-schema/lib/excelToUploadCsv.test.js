import { assertEquals , Deno } from './denoShim.js'
import { excelToUploadCsv } from "./excelToUploadCsv.js"

// ── byte-동일 fixture (2026-07-22 사용자 확정) ──────────────────────────────

Deno.test('byte-동일 fixture: 사용자 확정 출력값과 정확히 일치', () => {
  const result = excelToUploadCsv({
    headers: ['number', 'string'],
    rows: [
      { number: '6', string: 'string6' },
      { number: '5', string: 'string5' },
    ],
    columnTypes: { number: 'number', string: 'string' },
  })
  assertEquals(result.csv, 'number,string,createdAt,updatedAt\n6,"string6",,\n5,"string5",,\n')
  assertEquals(result.errors, [])
})

// ── ① 예약 타임스탬프 열 제외 + 맨 끝 빈 createdAt·updatedAt 추가 ──────────

Deno.test('① createdAt 열 제외 + 맨 끝 빈 createdAt·updatedAt 추가', () => {
  const result = excelToUploadCsv({
    headers: ['name', 'createdAt'],
    rows: [{ name: 'Alice', createdAt: '2025-01-01' }],
    columnTypes: { name: 'string', createdAt: 'string' },
  })
  assertEquals(result.csv, 'name,createdAt,updatedAt\n"Alice",,\n')
})

Deno.test('① updatedAt 열 제외 + 맨 끝 빈 createdAt·updatedAt 추가', () => {
  const result = excelToUploadCsv({
    headers: ['name', 'updatedAt'],
    rows: [{ name: 'Bob', updatedAt: '2025-01-02' }],
    columnTypes: { name: 'string', updatedAt: 'string' },
  })
  assertEquals(result.csv, 'name,createdAt,updatedAt\n"Bob",,\n')
})

Deno.test('① snake_case created_at·updated_at 제외', () => {
  const result = excelToUploadCsv({
    headers: ['id', 'created_at', 'updated_at'],
    rows: [{ id: '1', created_at: '2025-01-01', updated_at: '2025-01-02' }],
    columnTypes: { id: 'number', created_at: 'string', updated_at: 'string' },
  })
  assertEquals(result.csv, 'id,createdAt,updatedAt\n1,,\n')
})

Deno.test('① 대소문자 무시: CreatedAt·UPDATEDAT 제외', () => {
  const result = excelToUploadCsv({
    headers: ['name', 'CreatedAt', 'UPDATEDAT'],
    rows: [{ name: 'Carol', CreatedAt: '2025-01-01', UPDATEDAT: '2025-01-02' }],
    columnTypes: { name: 'string', CreatedAt: 'string', UPDATEDAT: 'string' },
  })
  assertEquals(result.csv, 'name,createdAt,updatedAt\n"Carol",,\n')
})

// ── ② number 타입 = 무따옴표, string 타입 = 따옴표 ───────────────────────────

Deno.test('② number 타입은 무따옴표', () => {
  const result = excelToUploadCsv({
    headers: ['qty'],
    rows: [{ qty: '42' }, { qty: '3.14' }],
    columnTypes: { qty: 'number' },
  })
  assertEquals(result.csv, 'qty,createdAt,updatedAt\n42,,\n3.14,,\n')
})

Deno.test('② string 타입은 따옴표로 감쌈', () => {
  const result = excelToUploadCsv({
    headers: ['label'],
    rows: [{ label: 'hello' }],
    columnTypes: { label: 'string' },
  })
  assertEquals(result.csv, 'label,createdAt,updatedAt\n"hello",,\n')
})

// ── ③ 사용자 지정 string 타입 숫자형 문자열은 따옴표 ─────────────────────────

Deno.test('③ string 타입 선행 0 숫자 문자열("0101234")은 따옴표로 감쌈', () => {
  const result = excelToUploadCsv({
    headers: ['code'],
    rows: [{ code: '0101234' }],
    columnTypes: { code: 'string' },
  })
  assertEquals(result.csv, 'code,createdAt,updatedAt\n"0101234",,\n')
})

// ── ④ RFC4180 이스케이프 ────────────────────────────────────────────────────

Deno.test('④ 내부 따옴표 RFC4180 이스케이프(a"b → "a""b")', () => {
  const result = excelToUploadCsv({
    headers: ['val'],
    rows: [{ val: 'a"b' }],
    columnTypes: { val: 'string' },
  })
  assertEquals(result.csv, 'val,createdAt,updatedAt\n"a""b",,\n')
})

Deno.test('④ 쉼표 포함 값은 따옴표로 감쌈(a,b → "a,b")', () => {
  const result = excelToUploadCsv({
    headers: ['val'],
    rows: [{ val: 'a,b' }],
    columnTypes: { val: 'string' },
  })
  assertEquals(result.csv, 'val,createdAt,updatedAt\n"a,b",,\n')
})

// ── ⑤ BOM 없음·구분자·헤더 행 ───────────────────────────────────────────────

Deno.test('⑤ 출력에 BOM 없음', () => {
  const result = excelToUploadCsv({
    headers: ['x'],
    rows: [{ x: '1' }],
    columnTypes: { x: 'number' },
  })
  assertEquals(result.csv.startsWith('﻿'), false)
})

Deno.test('⑤ 구분자 쉼표, 첫 줄이 헤더 행(행 없어도 헤더 출력)', () => {
  const result = excelToUploadCsv({
    headers: ['a', 'b'],
    rows: [],
    columnTypes: {},
  })
  assertEquals(result.csv, 'a,b,createdAt,updatedAt\n')
})

// ── 결정론성 ────────────────────────────────────────────────────────────────

Deno.test('동일 입력 → 동일 출력(결정론성)', () => {
  const input = {
    headers: ['a', 'b'],
    rows: [{ a: '1', b: 'hello' }],
    columnTypes: { a: 'number', b: 'string' },
  }
  assertEquals(excelToUploadCsv(input).csv, excelToUploadCsv(input).csv)
})

// ── errors 구조 ────────────────────────────────────────────────────────────

Deno.test('정상 변환 시 errors는 빈 배열', () => {
  const result = excelToUploadCsv({
    headers: ['x'],
    rows: [{ x: '1' }],
    columnTypes: { x: 'number' },
  })
  assertEquals(Array.isArray(result.errors), true)
  assertEquals(result.errors.length, 0)
})
