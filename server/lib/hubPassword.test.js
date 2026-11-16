import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword } from './hubPassword.js'

describe('hashPassword', () => {
  it('scrypt$salt$hash 형식으로 만든다', () => {
    const h = hashPassword('cs-비밀')
    expect(h.split('$')).toHaveLength(3)
    expect(h.startsWith('scrypt$')).toBe(true)
  })

  it('같은 비밀번호도 매번 다른 해시 — salt가 매번 새로 생긴다', () => {
    expect(hashPassword('same')).not.toBe(hashPassword('same'))
  })

  it('평문이 해시에 남지 않는다', () => {
    expect(hashPassword('plaintext-secret')).not.toContain('plaintext-secret')
  })

  it('빈 비밀번호는 거부 — 해제는 NULL로 처리한다', () => {
    expect(() => hashPassword('')).toThrow()
  })
})

describe('verifyPassword', () => {
  it('맞는 비밀번호는 통과', () => {
    expect(verifyPassword('cs-비밀', hashPassword('cs-비밀'))).toBe(true)
  })

  it('틀린 비밀번호는 거부', () => {
    expect(verifyPassword('wrong', hashPassword('cs-비밀'))).toBe(false)
  })

  it('허브가 다르면 해시도 다르다 — delivery 비밀번호로 cs를 열 수 없다', () => {
    expect(verifyPassword('delivery-pw', hashPassword('cs-pw'))).toBe(false)
  })

  it('빈 입력·NULL 해시는 거부 — 비밀번호 없는 허브는 이 함수가 아니라 호출부에서 통과시킨다', () => {
    expect(verifyPassword('', hashPassword('x'))).toBe(false)
    expect(verifyPassword('x', null)).toBe(false)
    expect(verifyPassword('x', '')).toBe(false)
    expect(verifyPassword('x', undefined)).toBe(false)
  })

  it('형식이 깨진 해시는 던지지 않고 거부', () => {
    expect(verifyPassword('x', 'garbage')).toBe(false)
    expect(verifyPassword('x', 'scrypt$onlytwo')).toBe(false)
    expect(verifyPassword('x', 'bcrypt$aa$bb')).toBe(false)
    expect(verifyPassword('x', 'scrypt$zz$zz')).toBe(false)
  })
})
