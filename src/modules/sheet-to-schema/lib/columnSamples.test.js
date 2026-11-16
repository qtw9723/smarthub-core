import { assertEquals , Deno } from './denoShim.js'
import { collectColumnSamples } from "./columnSamples.js"

Deno.test('컬럼별 값을 최대 limit개까지 수집', () => {
  const r = collectColumnSamples({
    headers: ['상태'],
    rows: [{ 상태: 'a' }, { 상태: 'b' }, { 상태: 'c' }, { 상태: 'd' }],
  }, 3)
  assertEquals(r['상태'], ['a', 'b', 'c'])
})

Deno.test('빈 값은 건너뛴다', () => {
  const r = collectColumnSamples({
    headers: ['메모'],
    rows: [{ 메모: '' }, { 메모: '  ' }, { 메모: '내용' }],
  }, 3)
  assertEquals(r['메모'], ['내용'])
})

Deno.test('중복 값은 한 번만, 원본 순서 유지', () => {
  const r = collectColumnSamples({
    headers: ['구분'],
    rows: [{ 구분: 'B' }, { 구분: 'A' }, { 구분: 'B' }, { 구분: 'C' }],
  }, 3)
  assertEquals(r['구분'], ['B', 'A', 'C'])
})

Deno.test('긴 값은 maxLen에서 잘라 …를 붙인다', () => {
  const r = collectColumnSamples({
    headers: ['주소'],
    rows: [{ 주소: '서울특별시 강남구 테헤란로 123 45층 1234호' }],
  }, 3, 10)
  assertEquals(r['주소'], ['서울특별시 강남구 …'])
})

Deno.test('maxLen 이하 값은 그대로', () => {
  const r = collectColumnSamples({ headers: ['a'], rows: [{ a: '1234567890' }] }, 3, 10)
  assertEquals(r['a'], ['1234567890'])
})

Deno.test('값이 없는 컬럼은 빈 배열', () => {
  const r = collectColumnSamples({ headers: ['빈열'], rows: [{ 빈열: '' }] }, 3)
  assertEquals(r['빈열'], [])
})

Deno.test('행이 없어도 모든 헤더에 빈 배열', () => {
  const r = collectColumnSamples({ headers: ['a', 'b'], rows: [] }, 3)
  assertEquals(r, { a: [], b: [] })
})

Deno.test('값 앞뒤 공백은 다듬는다', () => {
  const r = collectColumnSamples({ headers: ['a'], rows: [{ a: '  값  ' }] }, 3)
  assertEquals(r['a'], ['값'])
})
