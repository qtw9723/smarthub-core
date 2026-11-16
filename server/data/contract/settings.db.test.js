// 저장소 계약 — 앱 설정(app_settings). 두 구현이 같은 결과를 낸다.
import { it, expect } from 'vitest'
import { contractSuite } from './harness.js'

contractSuite('settings', ({ repos }) => {
  it('없으면 null → set(새로·갱신) → get → remove', async () => {
    const s = () => repos().settings
    expect(await s().get('master_key_hash')).toBeNull()
    await s().set('master_key_hash', 'h1')
    await s().set('master_key_hash', 'h2')
    expect(await s().get('master_key_hash')).toBe('h2')
    await s().remove('master_key_hash')
    expect(await s().get('master_key_hash')).toBeNull()
  })
})
