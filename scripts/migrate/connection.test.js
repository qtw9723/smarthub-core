// 러너는 세션 advisory lock을 쓴다 — Supabase transaction pooler(6543)는 문장마다 다른 백엔드로 보낼 수 있어
// lock과 unlock이 엇갈리면 lock이 풀리지 않고, 다음 실행이 끝없이 기다린다. 접속 전에 거른다.
import { describe, it, expect } from 'vitest'
import { assertSessionConnection, MigrationError } from './runner.mjs'

describe('assertSessionConnection', () => {
  it('transaction pooler(6543)는 거부', () => {
    const run = () => assertSessionConnection('postgresql://postgres.abc:pw@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres')
    expect(run).toThrow(MigrationError)
    expect(run).toThrow(/TRANSACTION_POOLER/)
  })
  it('session pooler(5432)·직접 접속·로컬은 통과', () => {
    expect(() => assertSessionConnection('postgresql://postgres.abc:pw@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres')).not.toThrow()
    expect(() => assertSessionConnection('postgres://postgres:test@localhost:55432/postgres')).not.toThrow()
    expect(() => assertSessionConnection('postgres://u:p@smarthub-db/smarthub')).not.toThrow()
  })
  it('오류 메시지에 비밀번호를 담지 않는다', () => {
    try { assertSessionConnection('postgresql://u:s3cret@x.pooler.supabase.com:6543/postgres') } catch (e) { expect(e.message).not.toContain('s3cret') }
  })
})
