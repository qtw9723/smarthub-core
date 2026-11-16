// src/lib/uuid.js — 화면용 UUID v4.
// crypto.randomUUID는 보안 컨텍스트(https·localhost)에서만 있다. 사내 에디션은 사내망 http라 없으므로
// http에서도 있는 getRandomValues로 만든다. 화면 코드는 crypto.randomUUID 대신 이것을 쓴다(uuid.test.js가 지킨다).
export function randomId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40   // 버전 4
  b[8] = (b[8] & 0x3f) | 0x80   // 변형 10xx
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
