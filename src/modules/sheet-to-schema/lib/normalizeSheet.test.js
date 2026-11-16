import { assertEquals , Deno } from './denoShim.js'
import {
  normalizeSheetData,
  resolveHeaderKeys,
  detectHeaderRow,
  trimCell,
} from './normalizeSheet.js'

Deno.test('빈 입력 → 빈 결과', () => {
  assertEquals(normalizeSheetData([]), { headers: [], rows: [], headerSources: [], headerRow: 0 })
  assertEquals(normalizeSheetData(null), { headers: [], rows: [], headerSources: [], headerRow: 0 })
})

Deno.test('단순 2D 배열 → headers·rows 정규화', () => {
  const rawData = [
    ['name', 'age'],
    ['Alice', '30'],
    ['Bob', '25'],
  ]
  const { headers, rows } = normalizeSheetData(rawData)
  assertEquals(headers, ['name', 'age'])
  assertEquals(rows, [
    { name: 'Alice', age: '30' },
    { name: 'Bob', age: '25' },
  ])
})

Deno.test('완전 빈 행 제거', () => {
  const rawData = [
    ['name', 'age'],
    ['Alice', '30'],
    ['', ''],
    ['Bob', '25'],
    ['', ''],
  ]
  const { rows } = normalizeSheetData(rawData)
  assertEquals(rows.length, 2)
  assertEquals(rows[0], { name: 'Alice', age: '30' })
  assertEquals(rows[1], { name: 'Bob', age: '25' })
})

Deno.test('완전 빈 열 제거', () => {
  const rawData = [
    ['name', '', 'age'],
    ['Alice', '', '30'],
    ['Bob', '', '25'],
  ]
  const { headers, rows } = normalizeSheetData(rawData)
  assertEquals(headers, ['name', 'age'])
  assertEquals(rows, [
    { name: 'Alice', age: '30' },
    { name: 'Bob', age: '25' },
  ])
})

Deno.test('빈 열·빈 행 동시 제거', () => {
  const rawData = [
    ['name', '', 'age'],
    ['Alice', '', '30'],
    ['', '', ''],
    ['Bob', '', '25'],
  ]
  const { headers, rows } = normalizeSheetData(rawData)
  assertEquals(headers, ['name', 'age'])
  assertEquals(rows.length, 2)
})

Deno.test('숫자·기타 셀 값 → 문자열 변환', () => {
  const rawData = [
    ['count', 'ratio'],
    [42, 3.14],
    [0, -1],
  ]
  const { rows } = normalizeSheetData(rawData)
  assertEquals(rows[0], { count: '42', ratio: '3.14' })
  assertEquals(rows[1], { count: '0', ratio: '-1' })
})

Deno.test('헤더만 있고 데이터 행 없음 → 빈 rows', () => {
  const rawData = [['name', 'age']]
  const { headers, rows } = normalizeSheetData(rawData)
  assertEquals(headers, ['name', 'age'])
  assertEquals(rows, [])
})

Deno.test('결정론성: 동일 입력 2회 호출 → 동일 출력', () => {
  const rawData = [['x', 'y'], ['1', '2'], ['3', '4']]
  assertEquals(normalizeSheetData(rawData), normalizeSheetData(rawData))
})

// ── 2026-08-05 QA 회귀 — 헤더 키 충돌로 데이터가 사라지던 사고 ──────────────

Deno.test('resolveHeaderKeys: 트림·빈 헤더 이름 부여·중복 접미', () => {
  assertEquals(resolveHeaderKeys([' 고객명 ', '고객명', '', 'x']), ['고객명', '고객명_2', '열3', 'x'])
  assertEquals(resolveHeaderKeys(['a', 'a', 'a']), ['a', 'a_2', 'a_3'])
  assertEquals(resolveHeaderKeys([]), [])
  assertEquals(resolveHeaderKeys(null), [])
})

Deno.test('trimCell: 제로폭 공백·BOM도 제거', () => {
  assertEquals(trimCell('​'), '')
  assertEquals(trimCell(' 정상 '), '정상')
  assertEquals(trimCell('a﻿'), 'a')
  assertEquals(trimCell(null), '')
})

Deno.test('중복 헤더: 두 열의 값이 모두 살아남는다', () => {
  const { headers, rows, headerSources } = normalizeSheetData([
    ['고객명', '고객명'],
    ['김철수', '이영희'],
  ])
  assertEquals(headers, ['고객명', '고객명_2'])
  assertEquals(headerSources, ['고객명', '고객명'])
  assertEquals(rows, [{ 고객명: '김철수', 고객명_2: '이영희' }])
})

Deno.test('빈 헤더 열: 값이 다른 열을 덮어쓰지 않는다', () => {
  const { headers, rows } = normalizeSheetData([
    ['이름', '', ''],
    ['홍길동', '010-1111-2222', '비고1'],
  ])
  assertEquals(headers, ['이름', '열2', '열3'])
  assertEquals(rows, [{ 이름: '홍길동', 열2: '010-1111-2222', 열3: '비고1' }])
})

Deno.test('detectHeaderRow: 값이 가장 많이 채워진 첫 행', () => {
  assertEquals(detectHeaderRow([
    ['고객데이터 명세서', '', ''],
    ['작성자: 관리자', '작성일', ''],
    ['고객명', '주소', '비고'],
    ['홍길동', '서울', 'x'],
  ]), 2)
  // 근거가 약하면(최대 2칸 미만) 0행
  assertEquals(detectHeaderRow([['설명 시트'], ['본 시트는 설명용입니다.']]), 0)
  assertEquals(detectHeaderRow([]), 0)
})

Deno.test('headerRow 지정: 위쪽 제목 행을 버리고 그 행을 헤더로', () => {
  const raw = [
    ['고객데이터 명세서', '', ''],
    ['고객명', '전화', '비고'],
    ['홍길동', '010', 'x'],
  ]
  const byIndex = normalizeSheetData(raw, { headerRow: 1 })
  assertEquals(byIndex.headers, ['고객명', '전화', '비고'])
  assertEquals(byIndex.rows, [{ 고객명: '홍길동', 전화: '010', 비고: 'x' }])
  assertEquals(byIndex.headerRow, 1)

  const auto = normalizeSheetData(raw, { headerRow: 'auto' })
  assertEquals(auto.headers, ['고객명', '전화', '비고'])
  assertEquals(auto.headerRow, 1)
})

Deno.test('제로폭 공백만 있는 행은 빈 행으로 제거된다', () => {
  const { rows } = normalizeSheetData([
    ['a', 'b'],
    ['1', '2'],
    ['​', ' '],
  ])
  assertEquals(rows, [{ a: '1', b: '2' }])
})
