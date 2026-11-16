// server/lib/authThrottle.js — 로그인 시도 제한(마스터 키·허브 비밀번호).
//
// 2026-11-10 보안 검토 1번: 비밀번호만 있고 틀린 횟수 제한이 없어 무차별 대입이 그대로 가능했다(KISA CVE-2026-19877 유형).
// 외부 에디션은 인터넷에 공개라 실제 위협이다. 클라이언트별로 WINDOW_MS 안에 MAX_FAILURES번 틀리면 그 창이 지날 때까지 막는다 —
// 막힌 동안은 **맞는 키를 넣어도** 통과시키지 않는다(그래야 "맞으면 들어가진다"는 신호로 계속 찍어 볼 수 없다).
//
// 카운터는 DB(auth_failures)에 둔다 — Vercel 서버리스는 인스턴스마다 메모리가 따로라 인메모리로는 막지 못한다(hubCallLimit와 같은 이유).
// 세지 못하면(DB 장애) 막지 않는다: hubCallLimit(외부 청구 보호)과 반대 선택이다 — 여기서 닫으면 DB가 흔들릴 때 관리자까지 잠기고,
// 마스터 키 확인도 같은 이유로 DB 장애 때 서버 설정값으로 내려간다(lib/masterKey.js).
// 클라이언트는 IP의 해시로만 남긴다(원문 IP 미저장).
import { createHash } from 'node:crypto'
import { repos } from '../data/index.js'

export const MAX_FAILURES = 10
export const WINDOW_MS = 15 * 60 * 1000
const SCOPE = 'login'   // 마스터 키·허브 비밀번호를 한 창으로 센다 — 허브마다 따로 세면 허브 수만큼 시도가 늘어난다
const KEEP_MS = 24 * 60 * 60 * 1000

/**
 * 요청한 클라이언트의 식별자(IP 해시). 프록시가 넣는 x-real-ip(Vercel·ingress-nginx)를 먼저 쓴다.
 * x-forwarded-for 첫 값은 클라이언트가 꾸밀 수 있지만, 그 헤더만 있는 경로는 로컬·테스트뿐이다.
 */
export function clientOf(req) {
  const ip = req.headers['x-real-ip']
    || String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim()
    || req.socket?.remoteAddress
    || 'unknown'
  return createHash('sha256').update(String(ip)).digest('hex').slice(0, 32)
}

/** 이 클라이언트가 지금 막혀 있는가. */
export async function isBlocked(req) {
  try {
    const since = new Date(Date.now() - WINDOW_MS).toISOString()
    const n = await repos.authFailures.count(SCOPE, clientOf(req), since)
    return n >= MAX_FAILURES ? { blocked: true, retryAfterSec: WINDOW_MS / 1000 } : { blocked: false, retryAfterSec: 0 }
  } catch (e) {
    console.error('[authThrottle] 실패 횟수 조회 실패(막지 않음):', e.message)
    return { blocked: false, retryAfterSec: 0 }
  }
}

/** 틀린 시도를 남긴다. 실패해도 응답은 그대로(로그만). 가끔 하루 지난 기록을 지운다. */
export async function noteFailure(req) {
  try {
    await repos.authFailures.record(SCOPE, clientOf(req))
    if (Math.random() < 0.05) await repos.authFailures.prune(new Date(Date.now() - KEEP_MS).toISOString())
  } catch (e) {
    console.error('[authThrottle] 실패 기록 실패:', e.message)
  }
}

/** 막혔을 때 응답(429 + Retry-After). */
export function sendBlocked(res, retryAfterSec) {
  res.set('Retry-After', String(retryAfterSec))
  return res.status(429).json({ error: 'TOO_MANY_ATTEMPTS', retryAfterMinutes: Math.ceil(retryAfterSec / 60) })
}
