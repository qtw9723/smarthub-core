import { assertEquals , Deno } from './denoShim.js'
import { inferColumnTypes } from "./inferColumnTypes.js"

Deno.test('전부 숫자인 컬럼 → number', () => {
  const result = inferColumnTypes({
    headers: ['age'],
    rows: [{ age: '10' }, { age: '20' }, { age: '30' }],
  })
  assertEquals(result, { age: 'number' })
})

Deno.test('비숫자 값이 하나라도 있는 컬럼 → string', () => {
  const result = inferColumnTypes({
    headers: ['name'],
    rows: [{ name: 'Alice' }, { name: 'Bob' }],
  })
  assertEquals(result, { name: 'string' })
})

Deno.test('숫자와 문자열 혼합 컬럼 → string', () => {
  const result = inferColumnTypes({
    headers: ['code'],
    rows: [{ code: '123' }, { code: 'abc' }],
  })
  assertEquals(result, { code: 'string' })
})

Deno.test('빈 컬럼(모든 값이 빈칸) → string', () => {
  const result = inferColumnTypes({
    headers: ['optional'],
    rows: [{ optional: '' }, { optional: '' }],
  })
  assertEquals(result, { optional: 'string' })
})

Deno.test('일부 빈칸 + 나머지 전부 숫자 → number (빈칸 스킵)', () => {
  const result = inferColumnTypes({
    headers: ['score'],
    rows: [{ score: '' }, { score: '95' }, { score: '87' }],
  })
  assertEquals(result, { score: 'number' })
})

Deno.test('결정론성: 동일 입력 2회 호출 → 동일 출력', () => {
  const input = {
    headers: ['a', 'b'],
    rows: [{ a: '1', b: 'x' }, { a: '2', b: 'y' }],
  }
  assertEquals(inferColumnTypes(input), inferColumnTypes(input))
})

Deno.test('선행 0 문자열(0101234)은 number로 판정 (R2 UI에서 교정 가능)', () => {
  const result = inferColumnTypes({
    headers: ['phone'],
    rows: [{ phone: '0101234' }],
  })
  assertEquals(result, { phone: 'number' })
})

Deno.test('여러 컬럼 — 컬럼별 독립 추론', () => {
  const result = inferColumnTypes({
    headers: ['id', 'name', 'score'],
    rows: [
      { id: '1', name: 'Alice', score: '95' },
      { id: '2', name: 'Bob', score: '87' },
    ],
  })
  assertEquals(result, { id: 'number', name: 'string', score: 'number' })
})

Deno.test('소수·지수표기도 number로 판정', () => {
  const result = inferColumnTypes({
    headers: ['rate', 'big'],
    rows: [{ rate: '3.14', big: '1e5' }],
  })
  assertEquals(result, { rate: 'number', big: 'number' })
})

Deno.test('부호 있는 숫자(+/-) → number', () => {
  const result = inferColumnTypes({
    headers: ['delta'],
    rows: [{ delta: '-5' }, { delta: '+3' }],
  })
  assertEquals(result, { delta: 'number' })
})

Deno.test('rows가 빈 배열 → 모든 컬럼 string', () => {
  const result = inferColumnTypes({
    headers: ['a', 'b'],
    rows: [],
  })
  assertEquals(result, { a: 'string', b: 'string' })
})
