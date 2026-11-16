import { assertEquals , Deno } from './denoShim.js'
import { toEnglishFieldName, applyEnglishNames } from "./toEnglishFieldName.js"

Deno.test('ASCII: camelCase → snake_case', () => {
  assertEquals(toEnglishFieldName('customerName'), { name: 'customer_name', converted: true })
})

Deno.test('ASCII: 공백·하이픈도 밑줄로, 소문자화', () => {
  assertEquals(toEnglishFieldName('Order No'), { name: 'order_no', converted: true })
  assertEquals(toEnglishFieldName('order-date'), { name: 'order_date', converted: true })
})

Deno.test('한글 최장 일치: 전체 문자열 사전 항목이 우선', () => {
  assertEquals(toEnglishFieldName('전화번호'), { name: 'phone', converted: true })
  assertEquals(toEnglishFieldName('우편번호'), { name: 'zip_code', converted: true })
})

Deno.test('한글 합성: 조각을 이어 붙인다', () => {
  assertEquals(toEnglishFieldName('고객명'), { name: 'customer_name', converted: true })
  assertEquals(toEnglishFieldName('상품명'), { name: 'product_name', converted: true })
  assertEquals(toEnglishFieldName('주문번호'), { name: 'order_no', converted: true })
  assertEquals(toEnglishFieldName('예약번호'), { name: 'reservation_no', converted: true })
})

Deno.test('접미 여부/유무는 is_ 접두로', () => {
  assertEquals(toEnglishFieldName('가입여부'), { name: 'is_signup', converted: true })
  assertEquals(toEnglishFieldName('재고유무'), { name: 'is_stock', converted: true })
})

Deno.test('한글+영문 혼합', () => {
  assertEquals(toEnglishFieldName('고객ID'), { name: 'customer_id', converted: true })
})

Deno.test('사전에 없는 조각이 있으면 원본 유지 + converted:false', () => {
  assertEquals(toEnglishFieldName('내부메모'), { name: '내부메모', converted: false })
  assertEquals(toEnglishFieldName('땡땡이'), { name: '땡땡이', converted: false })
})

Deno.test('반쪽 변환을 만들지 않는다', () => {
  // '고객'은 사전에 있지만 '땡땡'은 없다 → 전체를 포기한다
  assertEquals(toEnglishFieldName('고객땡땡'), { name: '고객땡땡', converted: false })
})

Deno.test('예약 열 이름으로는 매핑하지 않는다', () => {
  assertEquals(toEnglishFieldName('등록일'), { name: 'created_date', converted: true })
  assertEquals(toEnglishFieldName('수정일'), { name: 'updated_date', converted: true })
})

Deno.test('빈 값은 그대로', () => {
  assertEquals(toEnglishFieldName(''), { name: '', converted: false })
})

// 실무 엑셀에서 흔한 헤더 — 조각 하나가 없어 통째로 실패하던 것들 (2026-07-23 버그)
Deno.test('실무 헤더: 합성어 커버리지', () => {
  const cases = {
    '처리결과': 'process_result',
    '담당부서': 'department',
    '비고사항': 'note',
    '서비스명': 'service_name',
    '이용시간': 'usage_time',
    '신청내용': 'request_content',
    '차량번호': 'vehicle_no',
    '객실타입': 'room_type',
    '인원수': 'headcount',
    '결제수단': 'payment_method',
    '방문경로': 'visit_path',
    '민원유형': 'complaint_type',
    '상담내용': 'consultation_content',
    '회신여부': 'is_reply',
    '창구': 'counter',
    '기타': 'etc',
  }
  for (const [input, expected] of Object.entries(cases)) {
    assertEquals(toEnglishFieldName(input), { name: expected, converted: true }, `${input} 변환 실패`)
  }
})

// ── applyEnglishNames — 스펙 맵 일괄 변환 ────────────────────────────────────
// React setState 업데이터 안에서 실패 개수를 세다가 항상 0으로 읽히던 버그(2026-07-23)
// 때문에 순수 함수로 분리했다. 실패 목록을 반환값으로 돌려주므로 타이밍 문제가 없다.

Deno.test('applyEnglishNames: 사용 중인 컬럼만 변환하고 제외 컬럼은 건드리지 않는다', () => {
  const out = applyEnglishNames({
    '고객명': { include: true, outputName: '고객명' },
    '내부메모': { include: false, outputName: '내부메모' },
  })
  assertEquals(out.fieldSpecs['고객명'].outputName, 'customer_name')
  assertEquals(out.fieldSpecs['내부메모'].outputName, '내부메모')
})

Deno.test('applyEnglishNames: 변환 실패한 컬럼 이름을 목록으로 돌려준다', () => {
  const out = applyEnglishNames({
    '고객명': { include: true, outputName: '고객명' },
    '땡땡이': { include: true, outputName: '땡땡이' },
    '뿅뿅': { include: true, outputName: '뿅뿅' },
  })
  assertEquals(out.failed, ['땡땡이', '뿅뿅'])
})

Deno.test('applyEnglishNames: 전부 성공하면 빈 실패 목록', () => {
  const out = applyEnglishNames({ '수량': { include: true, outputName: '수량' } })
  assertEquals(out.failed, [])
  assertEquals(out.fieldSpecs['수량'].outputName, 'quantity')
})

Deno.test('applyEnglishNames: 제외된 컬럼은 실패로 세지 않는다', () => {
  const out = applyEnglishNames({ '땡땡이': { include: false, outputName: '땡땡이' } })
  assertEquals(out.failed, [])
})

Deno.test('applyEnglishNames: outputName이 없으면 원본 키로 변환한다', () => {
  const out = applyEnglishNames({ '수량': { include: true } })
  assertEquals(out.fieldSpecs['수량'].outputName, 'quantity')
})

Deno.test('applyEnglishNames: 다른 속성은 보존한다', () => {
  const out = applyEnglishNames({
    '고객명': { include: true, outputName: '고객명', type: 'string', key: true, crypt: 'true' },
  })
  assertEquals(out.fieldSpecs['고객명'].key, true)
  assertEquals(out.fieldSpecs['고객명'].crypt, 'true')
})
