// 사내 업로드 토큰 — 서버가 만든 경로와 만료 시각에 묶인 HMAC(Supabase 서명 업로드 URL의 사내판).
// 형식: `<만료 epoch ms>.<base64url(hmac-sha256(secret, path + '|' + 만료))>`
import { createHmac, timingSafeEqual } from 'node:crypto'

const mac = (path, exp, secret) => createHmac('sha256', secret).update(`${path}|${exp}`).digest('base64url')

export function signToken(path, expMs, secret) {
  return `${expMs}.${mac(path, expMs, secret)}`
}

export function verifyToken(path, token, secret, now = Date.now()) {
  if (typeof token !== 'string') return false
  const parts = token.split('.')
  if (parts.length !== 2 || !/^\d+$/.test(parts[0]) || !parts[1]) return false
  const exp = Number(parts[0])
  if (exp < now) return false
  const want = Buffer.from(mac(path, exp, secret))
  const got = Buffer.from(parts[1])
  return want.length === got.length && timingSafeEqual(want, got)
}
