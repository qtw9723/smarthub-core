// server/lib/ids.test.js — 경로 파라미터 형식 판정.
import { describe, it, expect } from 'vitest'
import { isUuid, isIntId } from './ids.js'

describe('isUuid', () => {
  it('정상 UUID', () => {
    expect(isUuid('82eca098-04f7-4004-babd-8606fc52810f')).toBe(true)
    expect(isUuid('82ECA098-04F7-4004-BABD-8606FC52810F')).toBe(true)
  })
  it('아닌 것들', () => {
    for (const v of ['not-a-uuid', '', '123', undefined, null, 42,
                     '82eca098-04f7-4004-babd-8606fc52810', '82eca098_04f7_4004_babd_8606fc52810f']) {
      expect(isUuid(v)).toBe(false)
    }
  })
})

describe('isIntId', () => {
  it('양의 정수 문자열', () => {
    expect(isIntId('1')).toBe(true)
    expect(isIntId('9007199254740993')).toBe(true) // bigint — 문자열로 다룬다
  })
  it('아닌 것들', () => {
    for (const v of ['abc', '', '1.5', '-1', '0', '1e3', ' 1', '1 ', undefined, null]) {
      expect(isIntId(v)).toBe(false)
    }
  })
})
