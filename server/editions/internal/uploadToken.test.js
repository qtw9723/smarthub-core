// 사내 업로드 토큰 — 서버가 만든 경로·만료에 묶인 HMAC. Supabase 서명 업로드 URL의 사내판.
import { describe, it, expect } from 'vitest'
import { signToken, verifyToken } from './uploadToken.js'

const SECRET = 'test-secret-0123456789abcdef0123456789'
const PATH = '11111111-1111-4111-8111-111111111111/f/a.pdf'
const NOW = 1_800_000_000_000

describe('uploadToken', () => {
  it('같은 경로·만료 전이면 통과', () => {
    expect(verifyToken(PATH, signToken(PATH, NOW + 60_000, SECRET), SECRET, NOW)).toBe(true)
  })
  it('다른 경로면 거부', () => {
    expect(verifyToken(`${PATH}x`, signToken(PATH, NOW + 60_000, SECRET), SECRET, NOW)).toBe(false)
  })
  it('만료 뒤면 거부', () => {
    expect(verifyToken(PATH, signToken(PATH, NOW - 1, SECRET), SECRET, NOW)).toBe(false)
  })
  it('만료 시각을 바꾸면(서명 불일치) 거부', () => {
    const [, sig] = signToken(PATH, NOW + 60_000, SECRET).split('.')
    expect(verifyToken(PATH, `${NOW + 9_999_999}.${sig}`, SECRET, NOW)).toBe(false)
  })
  it('다른 비밀로 만든 토큰은 거부', () => {
    expect(verifyToken(PATH, signToken(PATH, NOW + 60_000, `${SECRET}x`), SECRET, NOW)).toBe(false)
  })
  it.each([undefined, '', 'abc', '123.', '.sig', '12.34.56'])('형식이 깨진 토큰(%s)은 거부', (tok) => {
    expect(verifyToken(PATH, tok, SECRET, NOW)).toBe(false)
  })
})
