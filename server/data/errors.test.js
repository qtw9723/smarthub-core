// 저장소 오류 규약 — 두 구현(supabase·pg)이 유일 제약 위반을 같은 오류로 알린다.
import { describe, it, expect } from 'vitest'
import { UniqueViolationError, toRepoError } from './errors.js'

describe('toRepoError', () => {
  it('23505(supabase 오류 객체)는 UniqueViolationError', () => {
    const e = toRepoError({ code: '23505', message: 'duplicate key value violates unique constraint "hubs_key_key"' })
    expect(e).toBeInstanceOf(UniqueViolationError)
  })
  it('23505(pg 오류)는 UniqueViolationError이고 제약 이름을 담는다', () => {
    const err = Object.assign(new Error('dup'), { code: '23505', constraint: 'hubs_key_key' })
    expect(toRepoError(err).constraint).toBe('hubs_key_key')
  })
  it('그 밖의 오류는 Error로 그대로(메시지 보존)', () => {
    const e = toRepoError({ code: '42P01', message: 'relation does not exist' })
    expect(e).toBeInstanceOf(Error)
    expect(e).not.toBeInstanceOf(UniqueViolationError)
    expect(e.message).toContain('relation does not exist')
  })
})
