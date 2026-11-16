// server/modules/mailer/index.test.js
import { describe, it, expect, vi } from 'vitest'

const mockFrom = vi.hoisted(() => vi.fn())
vi.mock('../../db.js', () => ({ default: { from: mockFrom } }))

function mockQuery(result) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  }
}

import mod from './index.js'

describe('mailer 모듈 계약', () => {
  it('계약 필드를 갖는다', () => {
    expect(mod.key).toBe('mailer')
    expect(mod.apiRouter).toBeTypeOf('function')
    expect(mod.overview).toBeTypeOf('function')
  })

  it('overview는 job_count/active_count 요약과 items를 반환한다', async () => {
    mockFrom.mockReturnValueOnce(mockQuery({
      data: [
        { id: 'j1', name: 'A', is_active: true },
        { id: 'j2', name: 'B', is_active: false },
      ],
      error: null,
    }))
    const o = await mod.overview('hub-cs-id')
    expect(o.summary).toEqual({ job_count: 2, active_count: 1 })
    expect(o.items).toHaveLength(2)
  })
})
