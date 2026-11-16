import { assertEquals , Deno } from './denoShim.js'
import {
  FIELD_TYPES,
  tokenizeName,
  isGeoName,
  isBooleanName,
  isForceStringName,
  isPiiName,
  isKeyCandidateName,
  isBooleanValue,
  csvTypeOf,
} from "./schemaFieldRules.js"

Deno.test('FIELD_TYPES: 생성기 계약과 동일한 4종', () => {
  assertEquals(FIELD_TYPES, ['string', 'number', 'boolean', 'geo'])
})

Deno.test('tokenizeName: camelCase 분해', () => {
  assertEquals(tokenizeName('customerName'), ['customer', 'name'])
})

Deno.test('tokenizeName: snake_case·공백·하이픈 분해', () => {
  assertEquals(tokenizeName('customer_name'), ['customer', 'name'])
  assertEquals(tokenizeName('customer name'), ['customer', 'name'])
  assertEquals(tokenizeName('customer-name'), ['customer', 'name'])
})

Deno.test('tokenizeName: 한글은 하나의 토큰으로 보존', () => {
  assertEquals(tokenizeName('고객명'), ['고객명'])
})

Deno.test('isGeoName: 위도·경도·좌표·lat·lng는 geo', () => {
  assertEquals(isGeoName('위도'), true)
  assertEquals(isGeoName('경도'), true)
  assertEquals(isGeoName('배송_좌표'), true)
  assertEquals(isGeoName('lat'), true)
  assertEquals(isGeoName('lng'), true)
  assertEquals(isGeoName('storeLatitude'), true)
})

Deno.test('isGeoName: 무관한 이름은 false', () => {
  assertEquals(isGeoName('상품명'), false)
  assertEquals(isGeoName('later'), false)
})

Deno.test('isBooleanName: is/has 접두 + 여부/유무', () => {
  assertEquals(isBooleanName('isActive'), true)
  assertEquals(isBooleanName('is_active'), true)
  assertEquals(isBooleanName('hasChild'), true)
  assertEquals(isBooleanName('가입여부'), true)
  assertEquals(isBooleanName('재고유무'), true)
})

Deno.test('isBooleanName: is로 시작하는 단어(island)는 false', () => {
  assertEquals(isBooleanName('island'), false)
  assertEquals(isBooleanName('issue'), false)
})

Deno.test('isForceStringName: 전화·우편번호 계열은 숫자여도 string', () => {
  assertEquals(isForceStringName('전화번호'), true)
  assertEquals(isForceStringName('휴대폰'), true)
  assertEquals(isForceStringName('phone'), true)
  assertEquals(isForceStringName('phoneNumber'), true)
  assertEquals(isForceStringName('우편번호'), true)
  assertEquals(isForceStringName('zipCode'), true)
})

Deno.test('isForceStringName: tel은 토큰 완전일치일 때만(hotel 오탐 방지)', () => {
  assertEquals(isForceStringName('tel'), true)
  assertEquals(isForceStringName('tel_no'), true)
  assertEquals(isForceStringName('hotel'), false)
  assertEquals(isForceStringName('hotelName'), false)
})

Deno.test('isPiiName: 인물 이름·연락처·주소는 개인정보', () => {
  assertEquals(isPiiName('이름'), true)
  assertEquals(isPiiName('고객명'), true)
  assertEquals(isPiiName('담당자'), true)
  assertEquals(isPiiName('customerName'), true)
  assertEquals(isPiiName('name'), true)
  assertEquals(isPiiName('전화번호'), true)
  assertEquals(isPiiName('email'), true)
  assertEquals(isPiiName('주소'), true)
  assertEquals(isPiiName('생년월일'), true)
})

Deno.test('isPiiName: 사물의 ~명/~Name은 개인정보 아님', () => {
  assertEquals(isPiiName('상품명'), false)
  assertEquals(isPiiName('회사명'), false)
  assertEquals(isPiiName('파일명'), false)
  assertEquals(isPiiName('productName'), false)
  assertEquals(isPiiName('storeName'), false)
})

Deno.test('isKeyCandidateName: id·번호·코드 계열', () => {
  assertEquals(isKeyCandidateName('id'), true)
  assertEquals(isKeyCandidateName('orderId'), true)
  assertEquals(isKeyCandidateName('예약번호'), true)
  assertEquals(isKeyCandidateName('상품코드'), true)
  assertEquals(isKeyCandidateName('code'), true)
})

Deno.test('isKeyCandidateName: 무관한 이름은 false', () => {
  assertEquals(isKeyCandidateName('수량'), false)
  assertEquals(isKeyCandidateName('메모'), false)
})

Deno.test('isBooleanValue: 대표 불리언 표기 허용, 1/0은 제외', () => {
  assertEquals(isBooleanValue('true'), true)
  assertEquals(isBooleanValue('FALSE'), true)
  assertEquals(isBooleanValue('Y'), true)
  assertEquals(isBooleanValue('아니오'), true)
  assertEquals(isBooleanValue('O'), true)
  assertEquals(isBooleanValue('1'), false)
  assertEquals(isBooleanValue('0'), false)
  assertEquals(isBooleanValue('메모'), false)
})

Deno.test('csvTypeOf: number만 number, 나머지는 string', () => {
  assertEquals(csvTypeOf('number'), 'number')
  assertEquals(csvTypeOf('string'), 'string')
  assertEquals(csvTypeOf('boolean'), 'string')
  assertEquals(csvTypeOf('geo'), 'string')
  assertEquals(csvTypeOf(undefined), 'string')
})
