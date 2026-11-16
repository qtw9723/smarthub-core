// 로그인 시도 제한 — 마스터 키·허브 비밀번호를 틀린 횟수를 클라이언트별로 DB에 세서 막는다(2026-11-10 보안 검토 1번,
// KISA CVE-2026-19877 유형: 비밀번호만 있고 시도 제한이 없으면 무차별 대입). 외부는 인터넷 공개라 실제 위협이다.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.unmock('./authThrottle.js')
const count = vi.fn()
const record = vi.fn()
const prune = vi.fn()
vi.mock('../data/index.js', () => ({ repos: { authFailures: { count: (...a) => count(...a), record: (...a) => record(...a), prune: (...a) => prune(...a) } } }))

const { clientOf, isBlocked, noteFailure, MAX_FAILURES, WINDOW_MS } = await import('./authThrottle.js')

const req = (headers = {}, ip = '10.0.0.9') => ({ headers, socket: { remoteAddress: ip } })

beforeEach(() => { count.mockReset(); record.mockReset(); prune.mockReset() })

describe('clientOf', () => {
  it('프록시가 넣은 x-real-ip를 먼저, 없으면 x-forwarded-for 첫 값, 없으면 소켓 주소', () => {
    const a = clientOf(req({ 'x-real-ip': '1.2.3.4', 'x-forwarded-for': '9.9.9.9' }))
    expect(a).toBe(clientOf(req({ 'x-real-ip': '1.2.3.4' })))
    expect(clientOf(req({ 'x-forwarded-for': '5.6.7.8, 10.0.0.1' }))).toBe(clientOf(req({}, '5.6.7.8')))
    expect(clientOf(req({}, '5.6.7.8'))).not.toBe(a)
  })
  it('IP 원문은 저장하지 않는다 — 해시만', () => {
    expect(clientOf(req({ 'x-real-ip': '1.2.3.4' }))).not.toContain('1.2.3.4')
    expect(clientOf(req({ 'x-real-ip': '1.2.3.4' }))).toMatch(/^[0-9a-f]{32}$/)
  })
})

describe('isBlocked', () => {
  it(`창(${WINDOW_MS / 60000}분) 안 실패가 ${MAX_FAILURES}회 미만이면 통과`, async () => {
    count.mockResolvedValue(MAX_FAILURES - 1)
    expect(await isBlocked(req())).toEqual({ blocked: false, retryAfterSec: 0 })
    const [scope, client, since] = count.mock.calls[0]
    expect(scope).toBe('login')
    expect(client).toBe(clientOf(req()))
    expect(Date.now() - Date.parse(since)).toBeGreaterThanOrEqual(WINDOW_MS - 1000)
  })
  it(`${MAX_FAILURES}회부터 막는다`, async () => {
    count.mockResolvedValue(MAX_FAILURES)
    expect(await isBlocked(req())).toEqual({ blocked: true, retryAfterSec: WINDOW_MS / 1000 })
  })
  it('세지 못하면 막지 않는다(로그만) — DB 장애로 관리자까지 잠기지 않게', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    count.mockRejectedValue(new Error('db down'))
    expect((await isBlocked(req())).blocked).toBe(false)
  })
})

describe('noteFailure', () => {
  it('scope login·해시된 클라이언트로 기록한다', async () => {
    await noteFailure(req({ 'x-real-ip': '1.2.3.4' }))
    expect(record).toHaveBeenCalledWith('login', clientOf(req({ 'x-real-ip': '1.2.3.4' })))
  })
  it('기록 실패는 응답을 막지 않는다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    record.mockRejectedValue(new Error('db down'))
    await expect(noteFailure(req())).resolves.toBeUndefined()
  })
})
