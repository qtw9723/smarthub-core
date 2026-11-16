import { assertEquals , Deno } from './denoShim.js'
import { applyFieldSelection } from "./applyFieldSelection.js"

const SHEET = {
  headers: ['예약번호', '고객명', '내부메모'],
  rows: [
    { '예약번호': 'R1', '고객명': '홍길동', '내부메모': 'x' },
    { '예약번호': 'R2', '고객명': '김철수', '내부메모': 'y' },
  ],
}
const SPECS = {
  '예약번호': { type: 'string', key: true, crypt: 'false', include: true, outputName: 'reservation_no' },
  '고객명': { type: 'string', key: false, crypt: 'true', include: true, outputName: 'customer_name' },
  '내부메모': { type: 'string', key: false, crypt: 'false', include: false, outputName: '내부메모' },
}

Deno.test('제외한 컬럼은 헤더에서 빠진다', () => {
  assertEquals(applyFieldSelection(SHEET, SPECS).headers, ['reservation_no', 'customer_name'])
})

Deno.test('행의 키가 출력명으로 교체되고 제외 컬럼 값은 사라진다', () => {
  assertEquals(applyFieldSelection(SHEET, SPECS).rows, [
    { reservation_no: 'R1', customer_name: '홍길동' },
    { reservation_no: 'R2', customer_name: '김철수' },
  ])
})

Deno.test('스펙도 출력명으로 재키잉되고 속성은 보존된다', () => {
  const out = applyFieldSelection(SHEET, SPECS).fieldSpecs
  assertEquals(Object.keys(out), ['reservation_no', 'customer_name'])
  assertEquals(out.reservation_no.key, true)
  assertEquals(out.customer_name.crypt, 'true')
})

Deno.test('원본 헤더 순서를 보존한다', () => {
  const out = applyFieldSelection(
    { headers: ['c', 'a', 'b'], rows: [] },
    {
      c: { include: true, outputName: 'z' },
      a: { include: true, outputName: 'y' },
      b: { include: true, outputName: 'x' },
    },
  )
  assertEquals(out.headers, ['z', 'y', 'x'])
})

Deno.test('outputName이 없거나 빈 값이면 원본명을 쓴다', () => {
  const out = applyFieldSelection(
    { headers: ['수량', '메모'], rows: [{ 수량: '1', 메모: 'm' }] },
    { 수량: { include: true }, 메모: { include: true, outputName: '' } },
  )
  assertEquals(out.headers, ['수량', '메모'])
  assertEquals(out.rows, [{ 수량: '1', 메모: 'm' }])
})

Deno.test('include가 지정되지 않은 컬럼은 포함으로 본다', () => {
  const out = applyFieldSelection({ headers: ['a'], rows: [] }, { a: { outputName: 'A' } })
  assertEquals(out.headers, ['A'])
})

Deno.test('스펙에 아예 없는 컬럼도 포함으로 보고 원본명을 쓴다', () => {
  const out = applyFieldSelection({ headers: ['a'], rows: [{ a: '1' }] }, {})
  assertEquals(out.headers, ['a'])
  assertEquals(out.rows, [{ a: '1' }])
})

Deno.test('전부 제외하면 빈 헤더와 빈 객체 행', () => {
  const out = applyFieldSelection(SHEET, {
    '예약번호': { include: false }, '고객명': { include: false }, '내부메모': { include: false },
  })
  assertEquals(out.headers, [])
  assertEquals(out.rows, [{}, {}])
  assertEquals(out.fieldSpecs, {})
})

// ── 2026-08-05 QA 회귀 — 개명 충돌로 값이 사라지던 사고 ──────────────────────

Deno.test('개명 결과가 겹치면 접미(_2)로 유일하게 만들고 값은 모두 보존한다', () => {
  const sheet = {
    headers: ['상품코드', '상품코드 '],
    rows: [{ 상품코드: 'P01', '상품코드 ': 'P02' }],
  }
  const specs = {
    상품코드: { outputName: 'product_code' },
    '상품코드 ': { outputName: 'product_code' },
  }
  const out = applyFieldSelection(sheet, specs)
  assertEquals(out.headers, ['product_code', 'product_code_2'])
  assertEquals(out.rows, [{ product_code: 'P01', product_code_2: 'P02' }])
  assertEquals(out.collisions, [
    { header: '상품코드 ', requested: 'product_code', applied: 'product_code_2' },
  ])
})

Deno.test('충돌이 없으면 collisions는 빈 배열', () => {
  const out = applyFieldSelection(
    { headers: ['a'], rows: [{ a: '1' }] },
    { a: { outputName: 'b' } },
  )
  assertEquals(out.collisions, [])
})

Deno.test('공백만 있는 outputName은 원본 헤더를 쓴다', () => {
  const out = applyFieldSelection(
    { headers: ['a'], rows: [{ a: '1' }] },
    { a: { outputName: '  ' } },
  )
  assertEquals(out.headers, ['a'])
})
