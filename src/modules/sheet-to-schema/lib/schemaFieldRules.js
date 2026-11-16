// 스키마 필드 속성 판정 규칙 (순수 모듈, 파싱 라이브러리·UI 무의존).
// 생성기 쪽 LLM 프롬프트(대상 생성기의 스키마 도출 코드의
// buildSchemaPrompt)의 추론 규칙을 결정론 코드로 이식한 것.

// 생성기 계약과 동일한 타입 4종.
export const FIELD_TYPES = ['string', 'number', 'boolean', 'geo']

/**
 * 열 이름을 소문자 토큰 배열로 분해한다.
 * - camelCase 경계 분리 (customerName → customer, name)
 * - 구분자(_ - 공백 등) 분리
 * - 한글은 분해되지 않고 하나의 토큰으로 남는다(매칭은 원문 substring으로 한다)
 * @param {string} name
 * @returns {string[]}
 */
export function tokenizeName(name) {
  return String(name ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9가-힣]+/)
    .filter(Boolean)
    .map((t) => t.toLowerCase())
}

// 한글은 substring, 영문은 토큰 완전일치로 판정한다.
// (영문 substring은 hotel→tel, island→is 같은 오탐을 만든다)
function matches(name, { korean = [], tokens = [] }) {
  const raw = String(name ?? '')
  if (korean.some((k) => raw.includes(k))) return true
  const toks = tokenizeName(raw)
  return toks.some((t) => tokens.includes(t))
}

const GEO = {
  korean: ['위도', '경도', '좌표'],
  tokens: ['lat', 'lng', 'lon', 'latitude', 'longitude', 'geo', 'coord', 'coords', 'coordinate'],
}

const FORCE_STRING = {
  korean: ['전화', '휴대폰', '핸드폰', '우편번호', '주민', '사업자', '계좌', '카드번호', '연락처', '연락망'],
  tokens: ['phone', 'tel', 'mobile', 'zip', 'zipcode', 'postal', 'ssn'],
}

// 개인정보(crypt=true) — 인물 이름은 아래 'name' 토큰 규칙으로 따로 판정한다.
const PII = {
  korean: [
    '이름', '성명', '성함', '고객명', '담당자', '수취인', '수령인', '예약자',
    '전화', '휴대폰', '핸드폰', '이메일', '메일', '주소', '생년월일', '생일',
    '주민', '계좌', '카드',
    // 2026-08-05 QA — 실제 전화번호가 들어오는데 crypt가 안 붙던 표기
    '연락처', '연락망', '비상연락',
  ],
  tokens: [
    'phone', 'tel', 'mobile', 'email', 'mail', 'address', 'addr',
    'birth', 'birthday', 'birthdate', 'dob', 'ssn', 'account', 'card',
  ],
}

// 'name' 토큰은 인물일 때만 개인정보 — productName·storeName 오탐 방지.
const PERSON_PREFIX = [
  'customer', 'user', 'client', 'member', 'guest', 'owner', 'person',
  'employee', 'staff', 'contact', 'first', 'last', 'full', 'receiver', 'sender',
]

const KEY_CANDIDATE = {
  korean: ['번호', '코드', '아이디'],
  tokens: ['id', 'no', 'code', 'key', 'uid', 'uuid', 'seq', 'num'],
}

// 값 기반 불리언 판정 표기. 1/0은 숫자와 구분되지 않아 제외한다.
const BOOLEAN_VALUES = new Set([
  'true', 'false', 'y', 'n', 'yes', 'no', '예', '아니오', '아니요', 'o', 'x',
])

/** 위경도·좌표 열인가 */
export function isGeoName(name) {
  return matches(name, GEO)
}

/** is/has 접두 또는 여부/유무가 붙은 불리언 열인가 */
export function isBooleanName(name) {
  const raw = String(name ?? '')
  if (raw.includes('여부') || raw.includes('유무')) return true
  const toks = tokenizeName(raw)
  // 'island'는 토큰 1개라 걸러진다 — is/has가 독립 토큰일 때만 불리언.
  return toks.length >= 2 && (toks[0] === 'is' || toks[0] === 'has')
}

/** 값이 전부 숫자여도 string으로 강제할 열인가 (전화번호·우편번호 등, 선행 0 보존) */
export function isForceStringName(name) {
  return matches(name, FORCE_STRING)
}

/** 개인정보 열인가 (crypt="true") */
export function isPiiName(name) {
  if (matches(name, PII)) return true
  const toks = tokenizeName(name)
  const last = toks[toks.length - 1]
  if (last !== 'name') return false
  // 'name' 단독이거나 인물 접두와 결합했을 때만 개인정보.
  return toks.length === 1 || PERSON_PREFIX.includes(toks[toks.length - 2])
}

/** 식별자 후보 이름인가 (실제 key 여부는 값 고유성까지 본다) */
export function isKeyCandidateName(name) {
  return matches(name, KEY_CANDIDATE)
}

/** 불리언으로 볼 수 있는 셀 값인가 */
export function isBooleanValue(value) {
  return BOOLEAN_VALUES.has(String(value ?? '').trim().toLowerCase())
}

/**
 * 스키마 타입을 CSV 직렬화 타입으로 매핑한다.
 * number만 무따옴표, boolean·geo·string은 따옴표 문자열(기존 uploadCsvRules 규칙 그대로).
 * @param {string} fieldType
 * @returns {'number'|'string'}
 */
export function csvTypeOf(fieldType) {
  return fieldType === 'number' ? 'number' : 'string'
}
