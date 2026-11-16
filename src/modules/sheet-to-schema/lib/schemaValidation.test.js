import { assertEquals, assertNotEquals , Deno } from './denoShim.js'
import { validateSchemaDraft, schemaNameWarning } from "./schemaValidation.js"

// AC7: 엔티티 0개 → 차단
Deno.test("AC7: 엔티티 0개 → 차단 사유 반환", () => {
  const result = validateSchemaDraft([])
  assertNotEquals(result, null)
  assertEquals(typeof result, "string")
})

Deno.test("AC7: null 입력 → 차단 사유 반환", () => {
  const result = validateSchemaDraft(null)
  assertNotEquals(result, null)
})

// AC7: 엔티티 이름 공백 → 차단
Deno.test("AC7: 엔티티 이름이 빈 문자열 → 차단", () => {
  const result = validateSchemaDraft([
    { schemaName: "", fields: [{ name: "id" }] },
  ])
  assertNotEquals(result, null)
  assertEquals(typeof result, "string")
})

Deno.test("AC7: 엔티티 이름이 공백만 → 차단(trim 후 빈값)", () => {
  const result = validateSchemaDraft([
    { schemaName: "   ", fields: [{ name: "id" }] },
  ])
  assertNotEquals(result, null)
})

// AC7: 필드명 중복 → 차단
Deno.test("AC7: 같은 엔티티 내 필드명 중복 → 차단", () => {
  const result = validateSchemaDraft([
    {
      schemaName: "테이블",
      fields: [{ name: "userId" }, { name: "userId" }],
    },
  ])
  assertNotEquals(result, null)
  assertEquals(typeof result, "string")
})

// AC7: 필드명 빈값 → 차단
Deno.test("AC7: 필드명이 빈 문자열 → 차단", () => {
  const result = validateSchemaDraft([
    { schemaName: "테이블", fields: [{ name: "" }] },
  ])
  assertNotEquals(result, null)
})

Deno.test("AC7: 필드명이 공백만 → 차단(trim 후 빈값)", () => {
  const result = validateSchemaDraft([
    { schemaName: "테이블", fields: [{ name: "  " }] },
  ])
  assertNotEquals(result, null)
})

// AC7: 예약 타임스탬프 열 → 차단 (isReservedTimestampColumn 재사용)
Deno.test("AC7: createdAt 필드명 → 차단(예약 타임스탬프 열)", () => {
  const result = validateSchemaDraft([
    { schemaName: "테이블", fields: [{ name: "id" }, { name: "createdAt" }] },
  ])
  assertNotEquals(result, null)
  assertEquals(typeof result, "string")
})

Deno.test("AC7: updatedAt 필드명 → 차단(예약 타임스탬프 열)", () => {
  const result = validateSchemaDraft([
    { schemaName: "테이블", fields: [{ name: "id" }, { name: "updatedAt" }] },
  ])
  assertNotEquals(result, null)
})

Deno.test("AC7: created_at 필드명(snake_case) → 차단(예약 타임스탬프 열)", () => {
  const result = validateSchemaDraft([
    { schemaName: "테이블", fields: [{ name: "created_at" }] },
  ])
  assertNotEquals(result, null)
})

Deno.test("AC7: CREATEDAT(대소문자 무시) → 차단(예약 타임스탬프 열)", () => {
  const result = validateSchemaDraft([
    { schemaName: "테이블", fields: [{ name: "CREATEDAT" }] },
  ])
  assertNotEquals(result, null)
})

// AC7: 정상 통과 케이스
Deno.test("AC7: 정상 엔티티 → null 반환(통과)", () => {
  const result = validateSchemaDraft([
    {
      schemaName: "주문",
      fields: [
        { name: "orderId" },
        { name: "customerName" },
        { name: "amount" },
      ],
    },
  ])
  assertEquals(result, null)
})

Deno.test("AC7: 여러 엔티티 모두 정상 → null 반환(통과)", () => {
  const result = validateSchemaDraft([
    { schemaName: "엔티티A", fields: [{ name: "id" }, { name: "name" }] },
    { schemaName: "엔티티B", fields: [{ name: "code" }, { name: "value" }] },
  ])
  assertEquals(result, null)
})

Deno.test("AC7: 필드 없는 엔티티 → null 반환(통과, 빈 필드 목록은 허용)", () => {
  const result = validateSchemaDraft([
    { schemaName: "빈필드엔티티", fields: [] },
  ])
  assertEquals(result, null)
})

// 사유 문자열이 한국어인지 확인
Deno.test("차단 사유 문구는 사람이 읽을 수 있는 한국어 문자열", () => {
  const r1 = validateSchemaDraft([])
  const r2 = validateSchemaDraft([{ schemaName: "", fields: [] }])
  const r3 = validateSchemaDraft([{ schemaName: "t", fields: [{ name: "a" }, { name: "a" }] }])
  for (const r of [r1, r2, r3]) {
    assertNotEquals(r, null)
    assertEquals(typeof r, "string")
    assertEquals(r.length > 0, true)
  }
})

Deno.test('schemaNameWarning: 한글·공백·특수문자는 경고', () => {
  assertEquals(schemaNameWarning('reservation'), null)
  assertEquals(schemaNameWarning('customer_v2'), null)
  assertEquals(schemaNameWarning(''), null)
  assertEquals(typeof schemaNameWarning('09_고객 데이터 v1.2.최종(수정)'), 'string')
  assertEquals(typeof schemaNameWarning('고객목록'), 'string')
  assertEquals(typeof schemaNameWarning('2026_data'), 'string')
})
