// 모든 허브 순회(?hub=*) — 사내 정시 작업은 허브가 늘어도 CronJob을 추가하지 않게 기능이 켜진 허브를 다 돈다.
import { describe, it, expect, vi } from 'vitest'

const hubs = [
  { id: 'a', key: 'a', enabled: true },
  { id: 'b', key: 'b', enabled: false },
  { id: 'c', key: 'c', enabled: true },
  { id: 'd', key: 'd', enabled: true },
  { id: 'e', key: 'e', enabled: true },
]
const features = { a: { enabled: true }, b: { enabled: true }, c: null, d: { enabled: true }, e: 'boom' }
vi.mock('../data/index.js', () => ({
  repos: {
    hubs: { listHubs: vi.fn(async () => hubs) },
    features: { getFeature: vi.fn(async (id) => { if (features[id] === 'boom') throw new Error('db down'); return features[id] }) },
  },
}))
const { forEachHub } = await import('./forEachHub.js')

describe('forEachHub', () => {
  it('켜진 허브 중 기능도 켜진 허브만 돈다', async () => {
    const seen = []
    await forEachHub('module-b', async (h) => { seen.push(h.key) })
    expect(seen).toEqual(['a', 'd'])
  })
  it('한 허브가 실패해도 다음 허브를 돌고, 결과에 남긴다', async () => {
    const out = await forEachHub('module-b', async (h) => {
      if (h.key === 'a') throw new Error('boom')
      return { processed: 1 }
    })
    expect(out).toEqual([
      { hub: 'a', ok: false, error: 'boom' },
      { hub: 'd', ok: true, result: { processed: 1 } },
      { hub: 'e', ok: false, error: '기능 조회 실패: db down' },
    ])
  })
})

// 리뷰(2026-11-09): 기능 조회 오류를 '꺼짐'처럼 조용히 건너뛰면 DB 장애가 결과에 안 보인다.
describe('forEachHub 기능 조회 오류', () => {
  it('결과에 실패로 남기고 fn은 부르지 않는다', async () => {
    const fn = vi.fn()
    const out = await forEachHub('module-b', fn)
    expect(out.find((r) => r.hub === 'e')).toEqual({ hub: 'e', ok: false, error: '기능 조회 실패: db down' })
    expect(fn.mock.calls.map(([h]) => h.key)).toEqual(['a', 'd'])
  })
})
