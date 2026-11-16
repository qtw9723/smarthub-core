// server/lib/hubPassword.js — 허브 비밀번호 해시/검증.
//
// 허브 비밀번호는 DB(hubs.password_hash)에 산다. 플랫폼 비밀번호(APP_PASSWORD)와 달리
// 백오피스에서 사용자가 정하는 값이 DB에 남으므로 평문으로 두지 않는다.
//
// 의존성을 늘리지 않으려고 bcrypt 대신 Node 내장 scrypt를 쓴다.
// 저장 형식: 'scrypt$<saltHex>$<hashHex>'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const KEY_LEN = 64
const PREFIX = 'scrypt'

/** 평문 → 저장용 해시 문자열. 빈 값은 해시하지 않는다(호출부에서 NULL 처리). */
export function hashPassword(plain) {
  if (typeof plain !== 'string' || plain === '') throw new Error('빈 비밀번호는 해시할 수 없습니다')
  const salt = randomBytes(16)
  const hash = scryptSync(plain, salt, KEY_LEN)
  return `${PREFIX}$${salt.toString('hex')}$${hash.toString('hex')}`
}

/**
 * 평문이 저장된 해시와 일치하는지. 형식이 깨졌거나 입력이 없으면 false.
 * 비교는 timingSafeEqual — 길이가 다르면 그 자체가 불일치다.
 */
export function verifyPassword(plain, stored) {
  if (typeof plain !== 'string' || plain === '') return false
  if (typeof stored !== 'string' || stored === '') return false

  const parts = stored.split('$')
  if (parts.length !== 3 || parts[0] !== PREFIX) return false

  const [, saltHex, hashHex] = parts
  let salt, expected
  try {
    salt = Buffer.from(saltHex, 'hex')
    expected = Buffer.from(hashHex, 'hex')
  } catch {
    return false
  }
  if (salt.length === 0 || expected.length !== KEY_LEN) return false

  const actual = scryptSync(plain, salt, KEY_LEN)
  return timingSafeEqual(actual, expected)
}
