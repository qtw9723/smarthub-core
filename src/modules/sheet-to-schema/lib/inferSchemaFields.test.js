import { assertEquals , Deno } from './denoShim.js'
import { inferSchemaFields } from "./inferSchemaFields.js"

Deno.test('type: 위경도 열은 geo', () => {
  const r = inferSchemaFields({
    headers: ['위도'],
    rows: [{ 위도: '37.5' }, { 위도: '35.1' }],
  })
  assertEquals(r['위도'].type, 'geo')
})

Deno.test('type: 이름이 불리언이면 값과 무관하게 boolean', () => {
  const r = inferSchemaFields({
    headers: ['가입여부'],
    rows: [{ 가입여부: 'Y' }, { 가입여부: 'N' }],
  })
  assertEquals(r['가입여부'].type, 'boolean')
})

Deno.test('type: 값이 전부 불리언 표기면 boolean', () => {
  const r = inferSchemaFields({
    headers: ['동의'],
    rows: [{ 동의: 'true' }, { 동의: 'false' }],
  })
  assertEquals(r['동의'].type, 'boolean')
})

Deno.test('type: 전화번호는 값이 전부 숫자여도 string(선행 0 보존)', () => {
  const r = inferSchemaFields({
    headers: ['전화번호'],
    rows: [{ 전화번호: '01012345678' }, { 전화번호: '01098765432' }],
  })
  assertEquals(r['전화번호'].type, 'string')
})

Deno.test('type: 값이 전부 숫자면 number', () => {
  const r = inferSchemaFields({
    headers: ['수량'],
    rows: [{ 수량: '1' }, { 수량: '25' }],
  })
  assertEquals(r['수량'].type, 'number')
})

Deno.test('type: 그 외는 string', () => {
  const r = inferSchemaFields({
    headers: ['메모'],
    rows: [{ 메모: '빠른 배송' }],
  })
  assertEquals(r['메모'].type, 'string')
})

Deno.test('crypt: 개인정보 열은 "true" 문자열', () => {
  const r = inferSchemaFields({
    headers: ['고객명', '전화번호', '주소'],
    rows: [{ 고객명: '홍길동', 전화번호: '01012345678', 주소: '서울시' }],
  })
  assertEquals(r['고객명'].crypt, 'true')
  assertEquals(r['전화번호'].crypt, 'true')
  assertEquals(r['주소'].crypt, 'true')
})

Deno.test('crypt: 사물의 ~명은 "false"', () => {
  const r = inferSchemaFields({
    headers: ['상품명', 'productName'],
    rows: [{ 상품명: '노트북', productName: 'Laptop' }],
  })
  assertEquals(r['상품명'].crypt, 'false')
  assertEquals(r['productName'].crypt, 'false')
})

Deno.test('key: 식별자 이름 + 값 전부 고유 → 첫 하나만 true', () => {
  const r = inferSchemaFields({
    headers: ['예약번호', '상품코드', '수량'],
    rows: [
      { 예약번호: 'R1', 상품코드: 'C1', 수량: '1' },
      { 예약번호: 'R2', 상품코드: 'C2', 수량: '2' },
    ],
  })
  assertEquals(r['예약번호'].key, true)
  assertEquals(r['상품코드'].key, false)
  assertEquals(r['수량'].key, false)
})

Deno.test('key: 이름은 식별자여도 값이 중복이면 false', () => {
  const r = inferSchemaFields({
    headers: ['상품코드'],
    rows: [{ 상품코드: 'C1' }, { 상품코드: 'C1' }],
  })
  assertEquals(r['상품코드'].key, false)
})

Deno.test('key: 빈 값이 있으면 false', () => {
  const r = inferSchemaFields({
    headers: ['주문번호'],
    rows: [{ 주문번호: 'A1' }, { 주문번호: '' }],
  })
  assertEquals(r['주문번호'].key, false)
})

Deno.test('key: 개인정보 열(전화번호)은 고유해도 key 아님', () => {
  const r = inferSchemaFields({
    headers: ['전화번호'],
    rows: [{ 전화번호: '01011112222' }, { 전화번호: '01033334444' }],
  })
  assertEquals(r['전화번호'].key, false)
})

Deno.test('key: 식별자가 없으면 전부 false', () => {
  const r = inferSchemaFields({
    headers: ['메모', '수량'],
    rows: [{ 메모: 'a', 수량: '1' }],
  })
  assertEquals(r['메모'].key, false)
  assertEquals(r['수량'].key, false)
})

Deno.test('예약 타임스탬프 열은 결과에서 제외', () => {
  const r = inferSchemaFields({
    headers: ['수량', 'createdAt', 'updated_at'],
    rows: [{ 수량: '1', createdAt: '2026-01-01', updated_at: '2026-01-02' }],
  })
  assertEquals(Object.keys(r), ['수량'])
})

Deno.test('행이 없어도 이름 기반 판정은 동작하고 key는 false', () => {
  const r = inferSchemaFields({ headers: ['예약번호', '고객명'], rows: [] })
  assertEquals(r['예약번호'], { type: 'string', key: false, crypt: 'false' })
  assertEquals(r['고객명'], { type: 'string', key: false, crypt: 'true' })
})
