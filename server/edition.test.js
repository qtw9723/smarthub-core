// 에디션 선택 — 외부(Vercel·Supabase)가 기본이고, SMARTHUB_EDITION=internal일 때만 사내 드라이버를 쓴다.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { edition } from './edition.js'

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

describe('edition()', () => {
  it.each([[undefined, 'external'], ['external', 'external'], ['foo', 'external'], ['internal', 'internal']])('SMARTHUB_EDITION=%s → %s', (v, want) => {
    if (v === undefined) vi.stubEnv('SMARTHUB_EDITION', '')
    else vi.stubEnv('SMARTHUB_EDITION', v)
    expect(edition()).toBe(want)
  })
})

describe('첨부 드라이버 선택', () => {
  it('기본은 외부 구현', async () => {
    vi.stubEnv('SMARTHUB_EDITION', '')
    vi.doMock('./editions/external/attachments.js', () => ({ which: 'external' }))
    vi.doMock('./editions/internal/attachments.js', () => ({ which: 'internal' }))
    const { attachments } = await import('./editions/attachments.js')
    expect(attachments.which).toBe('external')
  })
  it('internal이면 사내 구현', async () => {
    vi.stubEnv('SMARTHUB_EDITION', 'internal')
    vi.doMock('./editions/external/attachments.js', () => ({ which: 'external' }))
    vi.doMock('./editions/internal/attachments.js', () => ({ which: 'internal' }))
    const { attachments } = await import('./editions/attachments.js')
    expect(attachments.which).toBe('internal')
  })
})
