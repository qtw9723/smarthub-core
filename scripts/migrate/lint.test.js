// common 마이그레이션 린트 — 두 DB(외부 Supabase · 사내 자체 Postgres)에 같이 적용되는 SQL에
// Supabase 전용 문법이 섞이지 않게 막는다. 섞이면 사내 빈 DB에서 처음 적용할 때 터진다.
import { describe, it, expect } from 'vitest'
import { lintCommonSql, lintTransactionControl } from './lint.mjs'
import { OWNED_TABLES } from '../../db/ownedTables.mjs'

describe('lintCommonSql', () => {
  it('일반 DDL은 통과', () => {
    expect(lintCommonSql('create table t (id uuid primary key default gen_random_uuid());').ok).toBe(true)
  })

  it.each([
    ['grant select on t to anon;', 'anon'],
    ["select cron.schedule('x', '* * * * *', $$select 1$$);", 'cron.'],
    ['create policy p on storage.objects for select using (true);', 'storage.'],
    ['select auth.uid();', 'auth.'],
    ['create extension pg_net;', 'CREATE EXTENSION'],
  ])('%s 는 위반', (sql, pattern) => {
    const r = lintCommonSql(sql)
    expect(r.ok).toBe(false)
    expect(r.violations[0]).toMatchObject({ pattern, line: 1 })
  })

  it('주석·문자열 안의 단어는 무시', () => {
    expect(lintCommonSql("-- anon 차단은 external에서\ninsert into t(v) values ('cron.job');").ok).toBe(true)
  })

  it('pgcrypto 확장은 허용', () => {
    expect(lintCommonSql('create extension if not exists pgcrypto;').ok).toBe(true)
  })

  it('위반 줄 번호를 정확히 짚는다', () => {
    expect(lintCommonSql('select 1;\n/* 여러\n줄 */\nselect net.http_get(1);').violations).toEqual([{ pattern: 'net.', line: 4 }])
  })
})

describe('OWNED_TABLES', () => {
  it('소유 테이블 17개', () => {
    expect(OWNED_TABLES).toHaveLength(17)
    expect(OWNED_TABLES).toContain('mail_jobs')
  })
})

// 러너가 파일마다 트랜잭션을 연다 — 파일 안에서 트랜잭션을 끊으면 일부만 적용되고 기록은 없는 상태가 된다.
describe('lintTransactionControl', () => {
  it.each([
    ['select 1; commit; create table x();', 'COMMIT'],
    ['begin;\ncreate table x();', 'BEGIN'],
    ['start transaction;', 'BEGIN'],
    ['rollback;', 'ROLLBACK'],
    ['create index concurrently i on t (a);', 'CONCURRENTLY'],
  ])('%s 는 위반', (sql, pattern) => {
    expect(lintTransactionControl(sql).violations[0]).toMatchObject({ pattern })
  })
  it('plpgsql 함수 본문의 begin … end는 통과', () => {
    expect(lintTransactionControl('create function f() returns void language plpgsql as $$\nbegin\n  perform 1;\nend;\n$$;').ok).toBe(true)
  })
  it('주석 속 commit은 무시', () => {
    expect(lintTransactionControl('-- 끝나면 commit;\nselect 1;').ok).toBe(true)
  })
})
