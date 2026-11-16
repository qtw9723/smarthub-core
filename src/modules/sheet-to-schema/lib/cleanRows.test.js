import { assertEquals , Deno } from './denoShim.js'
import {
  cleanRows,
  isNumericString,
  normalizeNumberValue,
  normalizeBooleanValue,
  normalizeDateValue,
} from "./cleanRows.js"

// ── 항상 적용: 공백 트림 + 빈 행 제거 ───────────────────────────────────────

Deno.test("항상: 셀 앞뒤 공백 트림", () => {
  const out = cleanRows({
    headers: ["name", "memo"],
    rows: [{ name: "  홍길동 ", memo: "\t문의\n" }],
    columnTypes: { name: "string", memo: "string" },
  })
  assertEquals(out.rows[0], { name: "홍길동", memo: "문의" })
  assertEquals(out.stats.trimmedCells, 2)
})

Deno.test("항상: 완전히 빈 행 제거(빈 행 개수 집계)", () => {
  const out = cleanRows({
    headers: ["a", "b"],
    rows: [
      { a: "1", b: "x" },
      { a: "  ", b: "" }, // 트림 후 전부 빈값 → 제거
      { a: "", b: "" },
      { a: "2", b: "y" },
    ],
    columnTypes: { a: "number", b: "string" },
  })
  assertEquals(out.rows.length, 2)
  assertEquals(out.stats.removedEmpty, 2)
  assertEquals(out.rows.map((r) => r.a), ["1", "2"])
})

Deno.test("빈 입력/누락 필드 → 예외 없이 안전 반환", () => {
  assertEquals(cleanRows({}).rows, [])
  assertEquals(cleanRows({ headers: ["a"], rows: [{}] }).rows, []) // 전부 빈값 → 제거
  const out = cleanRows({ headers: ["a"], rows: [{ a: null }], columnTypes: {} })
  assertEquals(out.rows, [])
})

// ── 검증: number 컬럼 비-숫자 값 표시(정제 후 행 인덱스) ─────────────────────

Deno.test("검증: number 컬럼 비-숫자 값 → errors(빈 행 제거 후 인덱스)", () => {
  const out = cleanRows({
    headers: ["price", "name"],
    rows: [
      { price: "1000", name: "A" },
      { price: "", name: "" }, // 빈 행 → 제거되어 인덱스 밀림
      { price: "삼천원", name: "B" }, // 비-숫자
      { price: "2000", name: "C" },
    ],
    columnTypes: { price: "number", name: "string" },
  })
  assertEquals(out.rows.length, 3)
  assertEquals(out.errors, [{ row: 1, column: "price", message: '숫자 형식이 아닙니다: "삼천원"' }])
})

Deno.test("검증: 빈값은 오류 아님(number 컬럼이라도)", () => {
  const out = cleanRows({
    headers: ["price", "name"],
    rows: [{ price: "", name: "A" }],
    columnTypes: { price: "number", name: "string" },
  })
  assertEquals(out.errors, [])
  assertEquals(out.rows.length, 1)
})

// ── opt-in 기본 off: 정규화 안 함 ───────────────────────────────────────────

Deno.test("opt-in 기본값 off: 숫자 콤마·예/아니오·날짜 그대로 유지", () => {
  const out = cleanRows({
    headers: ["price", "flag", "day"],
    rows: [{ price: "1,000", flag: "예", day: "2026/1/5" }],
    columnTypes: { price: "number", flag: "string", day: "string" },
  })
  // 정규화 옵션 없이 → 값 유지(단 price는 number인데 "1,000"은 비-숫자라 오류로 표시)
  assertEquals(out.rows[0], { price: "1,000", flag: "예", day: "2026/1/5" })
  assertEquals(out.errors.length, 1)
  assertEquals(out.stats.normalizedCells, 0)
})

// ── opt-in: 숫자 포맷 정규화 ─────────────────────────────────────────────────

Deno.test("opt-in normalizeNumbers: 천단위 콤마·통화기호 제거", () => {
  const out = cleanRows({
    headers: ["price"],
    rows: [{ price: "1,000" }, { price: "₩5,000" }, { price: "삼천원" }],
    columnTypes: { price: "number" },
  }, { normalizeNumbers: true })
  assertEquals(out.rows.map((r) => r.price), ["1000", "5000", "삼천원"]) // 유효만 정리, 비숫자 유지
  assertEquals(out.errors.length, 1) // "삼천원"은 여전히 오류
})

Deno.test("normalizeNumberValue/isNumericString 단위", () => {
  assertEquals(normalizeNumberValue("1,234.5"), "1234.5")
  assertEquals(normalizeNumberValue("-2,000"), "-2000")
  assertEquals(normalizeNumberValue("abc"), "abc")
  assertEquals(isNumericString("1000"), true)
  assertEquals(isNumericString("1,000"), false)
  assertEquals(isNumericString(""), false)
})

// ── opt-in: 불린 정규화(number 컬럼 제외) ────────────────────────────────────

Deno.test("opt-in normalizeBooleans: 예/아니오·Y/N → true/false, number 컬럼 미변환", () => {
  const out = cleanRows({
    headers: ["agree", "qty"],
    rows: [{ agree: "예", qty: "1" }, { agree: "N", qty: "0" }],
    columnTypes: { agree: "string", qty: "number" },
  }, { normalizeBooleans: true })
  assertEquals(out.rows[0], { agree: "true", qty: "1" }) // qty(number)는 1→그대로
  assertEquals(out.rows[1], { agree: "false", qty: "0" })
})

Deno.test("normalizeBooleanValue 단위: 인식 못하면 null", () => {
  assertEquals(normalizeBooleanValue("예"), "true")
  assertEquals(normalizeBooleanValue("아니오"), "false")
  assertEquals(normalizeBooleanValue("maybe"), null)
})

// ── opt-in: 날짜 정규화 ──────────────────────────────────────────────────────

Deno.test("opt-in normalizeDates: 여러 구분자·YYYYMMDD → YYYY-MM-DD", () => {
  const out = cleanRows({
    headers: ["day"],
    rows: [{ day: "2026/1/5" }, { day: "2026.12.03" }, { day: "20260228" }, { day: "notadate" }],
    columnTypes: { day: "string" },
  }, { normalizeDates: true })
  assertEquals(out.rows.map((r) => r.day), ["2026-01-05", "2026-12-03", "2026-02-28", "notadate"])
})

Deno.test("normalizeDateValue 단위: 잘못된 월/일 → null", () => {
  assertEquals(normalizeDateValue("2026-13-01"), null)
  assertEquals(normalizeDateValue("2026-02-30"), "2026-02-30") // 일자 유효성은 31 이하만(엄격 달력검증 비범위)
  assertEquals(normalizeDateValue("hello"), null)
})

// ── 2026-08-05 QA 회귀 — 타입 판정과 검증 규칙이 어긋나던 사고 ───────────────

Deno.test('지수표기는 number 검증을 통과한다(타입 판정과 동일 기준)', () => {
  const out = cleanRows({
    headers: ['지수표기'],
    rows: [{ 지수표기: '1E+15' }],
    columnTypes: { 지수표기: 'number' },
  })
  assertEquals(out.errors, [])
})

Deno.test('boolean 컬럼의 true/false 아닌 값 → 경고(값은 그대로)', () => {
  const out = cleanRows({
    headers: ['수신동의여부'],
    rows: [{ 수신동의여부: '1' }, { 수신동의여부: 'true' }],
    columnTypes: { 수신동의여부: 'string' },
    fieldTypes: { 수신동의여부: 'boolean' },
  })
  assertEquals(out.errors, [])
  assertEquals(out.warnings.length, 1)
  assertEquals(out.warnings[0].row, 0)
  assertEquals(out.rows[0].수신동의여부, '1')
})

Deno.test('geo 컬럼은 숫자 또는 "위도, 경도"만 통과', () => {
  const out = cleanRows({
    headers: ['위도', '통합좌표', '지역'],
    rows: [{ 위도: '37.5665', 통합좌표: '37.5665, 126.9780', 지역: '서울시 강남구' }],
    columnTypes: { 위도: 'string', 통합좌표: 'string', 지역: 'string' },
    fieldTypes: { 위도: 'geo', 통합좌표: 'geo', 지역: 'geo' },
  })
  assertEquals(out.warnings.length, 1)
  assertEquals(out.warnings[0].column, '지역')
})

Deno.test('제로폭 공백만 있는 셀은 트림되어 빈 행으로 제거된다', () => {
  const out = cleanRows({
    headers: ['비고'],
    rows: [{ 비고: '​' }, { 비고: '정상' }],
    columnTypes: { 비고: 'string' },
  })
  assertEquals(out.stats.removedEmpty, 1)
  assertEquals(out.rows, [{ 비고: '정상' }])
})
