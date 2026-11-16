// 챗봇 체크 재시도 정책.
//
// 실측(2026-09-07): 최근 실패 12건 중 대부분이 `goto_failed: Timeout 30000ms`이고
// 여러 봇에 고루 걸렸다. 특정 봇의 시나리오 문제가
// 아니라 **일시적 접속 실패**다. 시도가 1회뿐이라 그때마다 실패 알림이 나갔고,
// 그 잡음이 "그 봇은 원래 실패한다"이라는 오해로 굳었다.
import { describe, it, expect, vi } from 'vitest'
import { runWithRetry, CHECK_ATTEMPTS } from './checkRetry.mjs'

const ok = { ok: true, detail: null, duration_ms: 10 }
const fail = (d = 'goto_failed: Timeout') => ({ ok: false, detail: d, duration_ms: 60_000 })

describe('runWithRetry', () => {
  it('처음 성공하면 다시 시도하지 않는다', async () => {
    const attempt = vi.fn().mockResolvedValue(ok)
    const res = await runWithRetry(attempt, { sleep: vi.fn() })
    expect(res.ok).toBe(true)
    expect(attempt).toHaveBeenCalledTimes(1)
  })

  it('일시적 실패는 재시도로 살린다', async () => {
    const attempt = vi.fn().mockResolvedValueOnce(fail()).mockResolvedValueOnce(ok)
    const res = await runWithRetry(attempt, { sleep: vi.fn() })
    expect(res.ok).toBe(true)
    expect(attempt).toHaveBeenCalledTimes(2)
  })

  it('재시도로 살아난 결과에는 실패 흔적을 남기지 않는다 — ok 계약을 바꾸지 않는다', async () => {
    const attempt = vi.fn().mockResolvedValueOnce(fail()).mockResolvedValueOnce(ok)
    // 시도 횟수(attempts)는 별도 필드로 붙는다. 여기서 고정하는 것은 ok/detail 계약이다 —
    // 재시도로 살아난 성공이 "ok인데 detail 있음"이 되지 않아야 한다.
    expect(await runWithRetry(attempt, { sleep: vi.fn() })).toMatchObject(ok)
  })

  it('전부 실패하면 마지막 결과를 돌려주되, 몇 번 시도했는지 밝힌다', async () => {
    const attempt = vi.fn().mockResolvedValue(fail('goto_failed: Timeout'))
    const res = await runWithRetry(attempt, { sleep: vi.fn() })
    expect(res.ok).toBe(false)
    expect(attempt).toHaveBeenCalledTimes(2)
    // 읽는 사람이 "한 번 걸린 것"과 "계속 걸리는 것"을 구분할 수 있어야 한다.
    expect(res.detail).toContain('2회 시도')
    expect(res.detail).toContain('goto_failed')
  })

  it('시도 사이에 기다린다', async () => {
    const sleep = vi.fn().mockResolvedValue()
    await runWithRetry(vi.fn().mockResolvedValue(fail()), { sleep, delayMs: 3000 })
    expect(sleep).toHaveBeenCalledWith(3000)
  })

  // 실측으로 정해진 값이다: 3초 간격 두 번이 같은 이유로 실패했다(느린 구간이 3초보다 길다).
  // 재시도가 앞 시도와 독립이 아니면 재시도가 아니라 그냥 두 번 실패다.
  it('기본 간격은 일시적 장애 구간을 넘길 만큼 길다', async () => {
    const sleep = vi.fn().mockResolvedValue()
    await runWithRetry(vi.fn().mockResolvedValue(fail()), { sleep })
    expect(sleep.mock.calls[0][0]).toBeGreaterThanOrEqual(30_000)
  })

  it('시도 횟수는 조절할 수 있다', async () => {
    const attempt = vi.fn().mockResolvedValue(fail())
    const res = await runWithRetry(attempt, { attempts: 3, sleep: vi.fn() })
    expect(attempt).toHaveBeenCalledTimes(3)
    expect(res.detail).toContain('3회 시도')
  })

  it('시도가 1회면 재시도 문구를 붙이지 않는다 — 거짓말하지 않는다', async () => {
    const res = await runWithRetry(vi.fn().mockResolvedValue(fail('boom')), { attempts: 1, sleep: vi.fn() })
    expect(res.detail).toBe('boom')
  })

  it('재시도 사실을 호출자에게 알린다 — 로그로 남길 수 있도록', async () => {
    const onRetry = vi.fn()
    await runWithRetry(vi.fn().mockResolvedValueOnce(fail('boom')).mockResolvedValueOnce(ok), { sleep: vi.fn(), onRetry })
    expect(onRetry).toHaveBeenCalledWith(1, 'boom')
  })
})

// 재시도가 실제로 무엇을 살렸는지 **세어 볼 수 있어야** 한다.
// 예전에는 재시도로 살아난 성공이 첫 시도 성공과 완전히 같은 모양이라
// (detail을 건드리지 않는 것이 의도였다) "재시도가 효과가 있었나"에 답할 데이터가 없었다.
// detail에 섞는 대신 **별도 필드**로 싣는다 — ok 계약은 그대로 둔다.
describe('runWithRetry — 시도 횟수 기록', () => {
  it('첫 시도에 성공하면 attempts는 1', async () => {
    const r = await runWithRetry(async () => ({ ok: true, detail: null, duration_ms: 1 }), { sleep: async () => {} })
    expect(r.attempts).toBe(1)
    expect(r.detail).toBeNull() // 성공 결과의 모양은 그대로
  })

  it('재시도로 살아나면 attempts는 2 — 첫 시도 성공과 구별된다', async () => {
    let n = 0
    const r = await runWithRetry(async () => (++n === 1
      ? { ok: false, detail: 'goto timeout', duration_ms: 30000 }
      : { ok: true, detail: null, duration_ms: 900 }), { sleep: async () => {} })
    expect(r.ok).toBe(true)
    expect(r.attempts).toBe(2)
    expect(r.detail).toBeNull() // 여전히 "ok인데 detail 있음"을 만들지 않는다
  })

  it('전부 실패해도 attempts를 싣는다', async () => {
    const r = await runWithRetry(async () => ({ ok: false, detail: 'x', duration_ms: 1 }), { sleep: async () => {} })
    expect(r.attempts).toBe(2)
  })

  it('attempts는 소진한 횟수가 아니라 실제 시도 횟수다', async () => {
    let n = 0
    const r = await runWithRetry(async () => (++n === 2
      ? { ok: true, detail: null, duration_ms: 1 }
      : { ok: false, detail: 'x', duration_ms: 1 }), { attempts: 5, sleep: async () => {} })
    expect(r.attempts).toBe(2)
  })
})


// 정기 점검 정책(ROADMAP v0.10.0 항목7): 즉시 재시도 끔. 0/59 구제 실측이 근거.
describe('정기 점검은 재시도하지 않는다', () => {
  it('CHECK_ATTEMPTS로 돌리면 실패해도 1회로 끝나고 기다리지 않는다', async () => {
    const attempt = vi.fn().mockResolvedValue({ ok: false, detail: 'goto_failed: timeout', duration_ms: 1 })
    const sleep = vi.fn()
    const r = await runWithRetry(attempt, { attempts: CHECK_ATTEMPTS, sleep })
    expect(attempt).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
    expect(r.attempts).toBe(1)
    // 알림 메일에 "[N회 시도 모두 실패]"가 붙지 않는다 — 시도한 적 없는 재시도를 말하지 않는다
    expect(r.detail).toBe('goto_failed: timeout')
  })
})
