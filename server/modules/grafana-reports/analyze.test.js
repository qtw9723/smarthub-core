import { describe, it, expect, vi } from 'vitest'
import { activeLogGroups, buildAnalyzePrompt, parseAnalysis, analyzeLogs, isRetryableError, withRetry, retryDelaySeconds, errorForStorage, isServerOverload, withDeadline } from './analyze.js'

const noSleep = () => Promise.resolve()

describe('activeLogGroups', () => {
  it('에러·빈 그룹 제외, 로그 있는 것만', () => {
    const logs = [
      { app: 'a', count: 3, rows: [{ time: 't', msg: 'm' }], error: null },
      { app: 'b', count: 0, rows: [], error: null },
      { app: 'c', count: 5, rows: [], error: '조회 실패' },
    ]
    expect(activeLogGroups(logs).map((g) => g.app)).toEqual(['a'])
  })
})

describe('buildAnalyzePrompt', () => {
  it('기존 유형과 로그를 포함', () => {
    const p = buildAnalyzePrompt(
      [{ app: 'soe', count: 2, rows: [{ time: '09:00', msg: 'timeout' }] }],
      [{ label: '타임아웃', description: '소켓 타임아웃' }],
    )
    expect(p).toContain('타임아웃')
    expect(p).toContain('soe')
    expect(p).toContain('timeout')
  })
  it('기존 유형 없으면 안내 문구', () => {
    expect(buildAnalyzePrompt([{ app: 'x', count: 1, rows: [] }], [])).toContain('(아직 없음)')
  })
  it('메모·빈도·추세가 있으면 유형 블록에 렌더', () => {
    const p = buildAnalyzePrompt(
      [{ app: 'soe', count: 1, rows: [{ time: '10:00', msg: 'e' }] }],
      [{
        label: '타임아웃', description: '소켓 타임아웃', note: '모니터링 중',
        ai_note: '평시 5~8건', total_count: 47,
        recentRuns: [{ date: '2026-06-24', count: 7 }, { date: '2026-06-23', count: 5 }],
      }],
    )
    expect(p).toContain('운영자 메모: 모니터링 중')
    expect(p).toContain('AI 메모: 평시 5~8건')
    expect(p).toContain('누적 47건')
    expect(p).toContain('최근 06-24:7, 06-23:5')
  })
  it('메모·빈도 없는 유형은 기존처럼 한 줄만', () => {
    const p = buildAnalyzePrompt(
      [{ app: 'x', count: 1, rows: [] }],
      [{ id: 'abc', label: 'A', description: 'd' }],
    )
    expect(p).toContain('- [id: abc] A: d')
    expect(p).not.toContain('· 운영자 메모')
    expect(p).not.toContain('· 누적')
  })
})

describe('parseAnalysis', () => {
  it('정상 JSON 정규화', () => {
    const text = JSON.stringify({
      summary: '- 점검1',
      types: [{ label: '타임아웃', description: 'd', app: 'soe', count: 4, existingMatch: '', rows: [0, 2, 5] }],
    })
    const r = parseAnalysis(text)
    expect(r.summary).toBe('- 점검1')
    expect(r.types).toHaveLength(1)
    expect(r.types[0]).toMatchObject({ label: '타임아웃', app: 'soe', count: 4, rows: [0, 2, 5] })
  })
  it('깨진 JSON은 빈 결과', () => {
    expect(parseAnalysis('not json')).toEqual({ summary: '', types: [] })
  })
  it('label 없는 유형은 제거, count 없으면 rows 길이로', () => {
    const text = JSON.stringify({ summary: '', types: [{ label: '', app: 'a' }, { label: 'x', app: 'a', rows: [1, 2] }] })
    const r = parseAnalysis(text)
    expect(r.types).toHaveLength(1)
    expect(r.types[0].count).toBe(2)
  })
  it('rows는 정수만·음수/중복 제거, 같은 메시지 여러 번이면 번호 모두 보존', () => {
    const text = JSON.stringify({ summary: '', types: [{ label: 'x', app: 'a', count: 3, rows: [0, 0, 1, -1, 2.9, 'x', 3] }] })
    expect(parseAnalysis(text).types[0].rows).toEqual([0, 1, 2, 3])
  })
  it('aiNote 정규화: 문자열 trim, 없으면 빈 문자열', () => {
    const r = parseAnalysis(JSON.stringify({
      summary: 's',
      types: [
        { label: 'A', app: 'x', count: 1, aiNote: '  평시 5건 수준  ' },
        { label: 'B', app: 'x', count: 1 },
      ],
    }))
    expect(r.types[0].aiNote).toBe('평시 5건 수준')
    expect(r.types[1].aiNote).toBe('')
  })
})

describe('isRetryableError', () => {
  it('Gemini 503(과부하)은 재시도 대상', () => {
    expect(isRetryableError(new Error('[503 Service Unavailable] This model is currently experiencing high demand.'))).toBe(true)
  })
  it('429 rate limit / overloaded 도 재시도 대상', () => {
    expect(isRetryableError(new Error('[429] rate limit exceeded'))).toBe(true)
    expect(isRetryableError(new Error('model is overloaded'))).toBe(true)
  })
  it('네트워크 계열(fetch failed/timeout)도 재시도 대상', () => {
    expect(isRetryableError(new Error('fetch failed'))).toBe(true)
    expect(isRetryableError(new Error('ETIMEDOUT'))).toBe(true)
  })
  it('설정 오류(GEMINI_API_KEY)는 재시도 안 함', () => {
    expect(isRetryableError(new Error('GEMINI_API_KEY 미설정'))).toBe(false)
  })
  it('일반 오류는 재시도 안 함', () => {
    expect(isRetryableError(new Error('boom'))).toBe(false)
  })
})

describe('withRetry', () => {
  it('일시 오류 후 성공하면 최종 성공값 반환', async () => {
    let n = 0
    const fn = () => { n++; if (n < 3) throw new Error('[503] high demand'); return 'ok' }
    const r = await withRetry(fn, { sleep: noSleep })
    expect(r).toBe('ok')
    expect(n).toBe(3)
  })
  it('재시도 불가 오류는 즉시 throw(한 번만 호출)', async () => {
    let n = 0
    const fn = () => { n++; throw new Error('boom') }
    await expect(withRetry(fn, { sleep: noSleep })).rejects.toThrow('boom')
    expect(n).toBe(1)
  })
  it('재시도 소진 시 마지막 오류 throw', async () => {
    let n = 0
    const fn = () => { n++; throw new Error('[503] high demand') }
    await expect(withRetry(fn, { retries: 2, sleep: noSleep })).rejects.toThrow('503')
    expect(n).toBe(3) // 최초 1 + 재시도 2
  })
})

describe('analyzeLogs', () => {
  it('분석 대상 없으면 LLM 호출 없이 빈 결과', async () => {
    const model = { generateContent: vi.fn() }
    const r = await analyzeLogs([{ app: 'a', count: 0, rows: [], error: null }], [], model)
    expect(r).toEqual({ summary: '', types: [] })
    expect(model.generateContent).not.toHaveBeenCalled()
  })
  it('주입 model로 호출 후 파싱', async () => {
    const model = {
      generateContent: vi.fn().mockResolvedValue({
        response: { text: () => JSON.stringify({ summary: 's', types: [{ label: 'L', app: 'soe', count: 1, logs: [] }] }) },
      }),
    }
    const r = await analyzeLogs([{ app: 'soe', count: 1, rows: [{ time: 't', msg: 'm' }], error: null }], [], model)
    expect(model.generateContent).toHaveBeenCalledOnce()
    expect(r.summary).toBe('s')
    expect(r.types[0].label).toBe('L')
  })
  it('Gemini 503 일시 실패는 재시도 후 성공', async () => {
    const generateContent = vi.fn()
      .mockRejectedValueOnce(new Error('[503 Service Unavailable] high demand'))
      .mockResolvedValueOnce({ response: { text: () => JSON.stringify({ summary: 's', types: [] }) } })
    const r = await analyzeLogs(
      [{ app: 'soe', count: 1, rows: [{ time: 't', msg: 'm' }], error: null }],
      [], { generateContent }, { retry: { sleep: noSleep } },
    )
    expect(generateContent).toHaveBeenCalledTimes(2)
    expect(r.summary).toBe('s')
  })
})

// 유형 매칭이 라벨 문자열 일치에 의존하면, 운영자가 라벨을 고치는 순간 같은 오류가
// 새 유형으로 갈라진다. 그래서 프롬프트에 **유형 id**를 함께 내려주고 그대로 돌려받는다.
describe('유형 매칭 키를 프롬프트에 싣는다', () => {
  const EXISTING = [{ id: '11111111-1111-4111-8111-111111111111', label: '타임아웃', description: 'soe 응답 지연' }]

  it('기존 유형 목록에 id가 들어간다', () => {
    const p = buildAnalyzePrompt([{ app: 'soe', count: 1, rows: [] }], EXISTING)
    expect(p).toContain(EXISTING[0].id)
    expect(p).toContain('타임아웃')
  })

  it('id를 돌려주라고 지시한다', () => {
    const p = buildAnalyzePrompt([{ app: 'soe', count: 1, rows: [] }], EXISTING)
    expect(p).toMatch(/existingMatchId/)
  })

  it('응답 스키마에 existingMatchId가 있다', async () => {
    const { RESPONSE_SCHEMA } = await import('./analyze.js')
    expect(RESPONSE_SCHEMA.properties.types.items.properties).toHaveProperty('existingMatchId')
  })

  it('parseAnalysis가 existingMatchId를 보존한다', () => {
    const out = parseAnalysis(JSON.stringify({
      summary: '- x',
      types: [{ label: 'A', app: 'soe', count: 1, existingMatchId: 'abc-123' }],
    }))
    expect(out.types[0].existingMatchId).toBe('abc-123')
  })

  it('existingMatchId가 없으면 빈 문자열 — 라벨 경로로 떨어진다', () => {
    const out = parseAnalysis(JSON.stringify({ summary: '- x', types: [{ label: 'A', app: 'soe', count: 1 }] }))
    expect(out.types[0].existingMatchId).toBe('')
  })
})

// 2026-10-07 실측: 일일 분석이 10월 들어 상시 실패했고 원인은 Gemini 무료 등급 하루 20건
// 한도였다. 그런데 429를 재시도 대상으로 분류해 호출 1회가 최대 4건이 되고 있었다 —
// 서버는 `retryDelay: 69302s`(≈19시간)를 알려주는데 백오프는 1·2·4초다. 성공할 수 없는
// 요청을 3번 더 보내고, 그 3번이 다시 할당량을 깎아 다음 날까지 고갈시켰다.
describe('isRetryableError — 할당량 고갈은 재시도 대상이 아니다', () => {
  const QUOTA_429 = new Error(
    '[GoogleGenerativeAI Error]: [429 Too Many Requests] You exceeded your current quota. ' +
    '* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20 ' +
    '[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"69302s"}]'
  )

  it('서버가 긴 retryDelay를 지시하면 429라도 재시도하지 않는다', () => {
    expect(isRetryableError(QUOTA_429)).toBe(false)
  })

  it('retryDelay가 백오프 예산 안이면 429는 그대로 재시도한다 — 분 단위 속도제한', () => {
    expect(isRetryableError(new Error('[429] rate limit. retryDelay: "3s"'))).toBe(true)
  })

  it('retryDelay 정보가 없는 429는 그대로 재시도한다 — 하위호환', () => {
    expect(isRetryableError(new Error('[429] rate limit exceeded'))).toBe(true)
  })

  it('서버 장애(5xx)는 retryDelay와 무관하게 재시도한다', () => {
    expect(isRetryableError(new Error('[503] unavailable'))).toBe(true)
  })

  it('withRetry가 할당량 오류를 더 쏘지 않고 즉시 전파한다', async () => {
    const fn = vi.fn().mockRejectedValue(QUOTA_429)
    await expect(withRetry(fn, { sleep: async () => {} })).rejects.toThrow(/429/)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

// 고갈 시각을 호출부가 알아야 "그날은 더 시도하지 않는다"를 결정할 수 있다.
describe('retryDelaySeconds', () => {
  it('retryDelay를 초로 읽는다', () => {
    expect(retryDelaySeconds(new Error('"retryDelay":"69302s"'))).toBe(69302)
  })
  it('공백·따옴표 형태도 읽는다', () => {
    expect(retryDelaySeconds(new Error('retryDelay: "3s"'))).toBe(3)
  })
  it('없으면 null', () => {
    expect(retryDelaySeconds(new Error('boom'))).toBeNull()
  })
})

// 분석 실패 사유는 DB에 남겨 사후에 본다(ROADMAP v0.10.0 항목8). 크론 응답은 ~1시간이면
// 지워져 10/13·10/14 07시 실패 원인을 놓쳤다. 다만 원문엔 키·토큰이 섞일 수 있어 가려서 남긴다.
describe('errorForStorage', () => {
  it('메시지를 그대로 남긴다', () => {
    expect(errorForStorage(new Error('[503 Service Unavailable] overloaded'))).toBe('[503 Service Unavailable] overloaded')
  })
  it('URL 쿼리의 key·Bearer 토큰·Google API 키를 가린다', () => {
    const s = errorForStorage(new Error('fetch https://x.googleapis.com/v1?key=AIzaSyA1234567890abcdefghijk&alt=sse Bearer abc.def AIzaSyZZZZZZZZZZZZZZZZZZZZZZZZZ'))
    expect(s).not.toMatch(/AIza/)
    expect(s).not.toContain('abc.def')
    expect(s).toContain('key=***')
    expect(s).toContain('&alt=sse')
  })
  it('너무 긴 메시지는 자른다', () => {
    expect(errorForStorage(new Error('x'.repeat(5000))).length).toBeLessThanOrEqual(2000)
  })
  it('Error가 아닌 값도 문자열로 받는다', () => {
    expect(errorForStorage('boom')).toBe('boom')
  })
})

// 10/15 07시: flash가 503 "high demand"로 재시도까지 실패 → 경량 모델로 대체.
describe('대체 모델', () => {
  const LOGS = [{ app: 'soe', count: 1, rows: [{ time: 't', msg: 'm' }], error: null }]
  const ok = { response: { text: () => JSON.stringify({ summary: '- 대체 분석', types: [] }) } }
  const noRetry = { retries: 0, sleep: async () => {} }

  it('주 모델이 503이면 대체 모델 결과를 쓴다', async () => {
    const primary = { generateContent: vi.fn().mockRejectedValue(new Error('[503 Service Unavailable] high demand')) }
    const fallbackModel = { generateContent: vi.fn().mockResolvedValue(ok) }
    const r = await analyzeLogs(LOGS, [], primary, { retry: noRetry, fallbackModel })
    expect(r.summary).toBe('- 대체 분석')
    expect(fallbackModel.generateContent).toHaveBeenCalledTimes(1)
  })

  it('429(할당량)는 대체하지 않고 그대로 던진다 — 차단 시각 기록이 판단한다', async () => {
    const primary = { generateContent: vi.fn().mockRejectedValue(new Error('[429] quota exceeded [{"retryDelay":"69302s"}]')) }
    const fallbackModel = { generateContent: vi.fn().mockResolvedValue(ok) }
    await expect(analyzeLogs(LOGS, [], primary, { retry: noRetry, fallbackModel })).rejects.toThrow(/429/)
    expect(fallbackModel.generateContent).not.toHaveBeenCalled()
  })

  it('대체 모델도 실패하면 그 오류를 던진다', async () => {
    const primary = { generateContent: vi.fn().mockRejectedValue(new Error('[503] high demand')) }
    const fallbackModel = { generateContent: vi.fn().mockRejectedValue(new Error('[500] internal')) }
    await expect(analyzeLogs(LOGS, [], primary, { retry: noRetry, fallbackModel })).rejects.toThrow(/500/)
  })

  it('모델을 주입하고 대체를 안 주면 대체 없이 던진다', async () => {
    const primary = { generateContent: vi.fn().mockRejectedValue(new Error('[503] high demand')) }
    await expect(analyzeLogs(LOGS, [], primary, { retry: noRetry })).rejects.toThrow(/503/)
  })

  it('isServerOverload: 5xx·high demand는 참, 429·일반 오류는 거짓', () => {
    expect(isServerOverload(new Error('[503 Service Unavailable] This model is currently experiencing high demand'))).toBe(true)
    expect(isServerOverload(new Error('[429] rate limit, high demand'))).toBe(false)
    expect(isServerOverload(new Error('fetch failed'))).toBe(false)
  })
})

describe('withDeadline', () => {
  it('시간 안에 끝나면 결과를 그대로 돌려준다', async () => {
    await expect(withDeadline(Promise.resolve('ok'), 1000)).resolves.toBe('ok')
  })
  it('상한을 넘기면 analysis-timeout으로 거부한다', async () => {
    vi.useFakeTimers()
    const p = withDeadline(new Promise(() => {}), 500)
    vi.advanceTimersByTime(500)
    await expect(p).rejects.toThrow(/analysis-timeout/)
    vi.useRealTimers()
  })
  it('남은 시간이 없으면 기다리지 않고 거부한다', async () => {
    await expect(withDeadline(new Promise(() => {}), 0)).rejects.toThrow(/analysis-timeout/)
  })
  it('진 쪽이 나중에 reject돼도 처리되지 않은 거부가 남지 않는다', async () => {
    let reject
    const slow = new Promise((_, r) => { reject = r })
    await expect(withDeadline(slow, 0)).rejects.toThrow(/analysis-timeout/)
    reject(new Error('late 503'))
    await new Promise((r) => setTimeout(r, 0))
  })
  it('타임아웃은 할당량 차단으로 오인되지 않는다', () => {
    expect(retryDelaySeconds(new Error('analysis-timeout: 500ms 안에 끝나지 않음'))).toBeFalsy()
  })
})
