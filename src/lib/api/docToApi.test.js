// docToApi — 프록시 라우터 호출 래퍼. grafana.js의 req() 패턴을 따른다.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { parseApiDoc } from './docToApi.js'

beforeEach(() => { vi.stubGlobal('fetch', vi.fn()) })
afterEach(() => { vi.unstubAllGlobals() })

describe('parseApiDoc', () => {
  it('hub 쿼리와 x-app-password 헤더를 붙여 POST한다', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ defs: [{ name: 'a' }] }) })

    const res = await parseApiDoc('POST /v1/orders', 'pw123', 'cs')

    expect(res).toEqual({ defs: [{ name: 'a' }] })
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toContain('/api/modules/doc-to-api/parse?hub=cs')
    expect(opts.method).toBe('POST')
    expect(opts.headers['x-app-password']).toBe('pw123')
    expect(JSON.parse(opts.body)).toEqual({ text: 'POST /v1/orders' })
  })

  it('401은 UNAUTHORIZED로 던진다', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 401, text: async () => 'nope' })
    await expect(parseApiDoc('x', 'bad', 'cs')).rejects.toThrow('UNAUTHORIZED')
  })

  it('그 외 실패는 서버 본문을 메시지로 던진다', async () => {
    global.fetch.mockResolvedValue({
      ok: false, status: 502,
      text: async () => JSON.stringify({ error: '자유형식 문서 추출에 실패했습니다.' }),
    })
    await expect(parseApiDoc('x', 'pw', 'cs')).rejects.toThrow(/추출에 실패/)
  })
})
