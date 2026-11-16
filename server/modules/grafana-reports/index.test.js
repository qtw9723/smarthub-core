import { describe, it, expect, vi } from 'vitest'

// router.js(그 아래 db.js)가 실제 createClient를 호출하지 않도록 mock
vi.mock('../../db.js', () => ({ default: { from: () => ({}) } }))

vi.mock('./sources.js', () => ({
  listSources: vi.fn(async () => [
    { enabled: false, last_analysis_date: '2026-07-21', last_analysis: { summary: '- a' } },
    { enabled: true, last_analysis_date: '2026-07-22', last_analysis: { summary: '- a\n- b' } },
  ]),
}))

import mod from './index.js'

describe('grafana-reports 모듈 계약', () => {
  it('계약 필드를 갖는다', () => {
    expect(mod.key).toBe('grafana-reports')
    expect(mod.apiRouter).toBeTypeOf('function')
    expect(mod.overview).toBeTypeOf('function')
  })
  it('overview는 소스들을 집계한다(활성 하나라도 있으면 enabled, 최신 분석일, 불릿 합계)', async () => {
    const o = await mod.overview('hub-cs-id')
    expect(o.summary.enabled).toBe(true)
    expect(o.summary.last_analysis_date).toBe('2026-07-22')
    expect(o.summary.last_alert_count).toBe(3) // 1 + 2
    expect(Array.isArray(o.items)).toBe(true)
  })
})
