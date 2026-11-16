// 백오피스 마스터 키 — DB에 바꾼 키(해시)가 있으면 그것, 없으면 서버 설정값(APP_PASSWORD).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { hashPassword } from './hubPassword.js'

// 공통 설정(src/test/masterKeyMock.js)의 대역 대신 실제 구현을 쓴다.
vi.unmock('./masterKey.js');

const store = vi.hoisted(() => ({ value: null, fail: false }))
vi.mock('../data/index.js', () => ({
  repos: {
    settings: {
      get: vi.fn(async () => { if (store.fail) throw new Error('db down'); return store.value }),
      set: vi.fn(async (_k, v) => { store.value = v }),
      remove: vi.fn(async () => { store.value = null }),
    },
  },
}))
const { isMasterKey, setMasterKey, MIN_LENGTH, resetMasterKeyCacheForTest } = await import('./masterKey.js')

beforeEach(() => { store.value = null; store.fail = false; process.env.APP_PASSWORD = 'env-key'; vi.clearAllMocks(); resetMasterKeyCacheForTest() })

describe('isMasterKey', () => {
  it('바꾼 적이 없으면 서버 설정값과 비교', async () => {
    expect(await isMasterKey('env-key')).toBe(true)
    expect(await isMasterKey('nope')).toBe(false)
  })
  it('APP_PASSWORD가 비어 있고 바꾼 키도 없으면 아무도 통과하지 못한다', async () => {
    process.env.APP_PASSWORD = ''
    expect(await isMasterKey('')).toBe(false)
    expect(await isMasterKey(undefined)).toBe(false)
  })
  it('바꾼 키가 있으면 그것만 — 서버 설정값은 더 이상 통하지 않는다', async () => {
    store.value = hashPassword('new-key-123')
    expect(await isMasterKey('new-key-123')).toBe(true)
    expect(await isMasterKey('env-key')).toBe(false)
  })
  it('DB를 읽지 못하면 서버 설정값으로 — 마이그레이션 전·DB 장애에도 백오피스가 잠기지 않게', async () => {
    store.fail = true
    expect(await isMasterKey('env-key')).toBe(true)
  })
})

describe('setMasterKey', () => {
  it('해시로 저장하고 바로 반영한다(캐시 무효화)', async () => {
    expect(await isMasterKey('env-key')).toBe(true)
    await setMasterKey('brand-new-key')
    expect(store.value).not.toContain('brand-new-key')
    expect(await isMasterKey('brand-new-key')).toBe(true)
    expect(await isMasterKey('env-key')).toBe(false)
  })
  it(`${'8'}자 미만은 거부`, async () => {
    await expect(setMasterKey('short')).rejects.toThrow(/8자/)
    expect(MIN_LENGTH).toBe(8)
  })
})
