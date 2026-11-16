// 두 DB 스키마 비교 — 외부(Supabase)와 사내(자체 Postgres)가 같은 마이그레이션을 받았는데도 갈라졌는지 본다.
import { describe, it, expect } from 'vitest'
import { diffSchemas } from './diff.mjs'

const base = () => ({
  tables: ['mail_jobs'],
  columns: {
    'mail_jobs.id': { type: 'uuid', nullable: 'NO', default: 'gen_random_uuid()' },
    'mail_jobs.subject': { type: 'text', nullable: 'NO', default: null },
  },
  indexes: { mail_jobs_pkey: 'CREATE UNIQUE INDEX mail_jobs_pkey ON mail_jobs USING btree (id)' },
  constraints: { 'mail_jobs.mail_jobs_pkey': 'PRIMARY KEY (id)' },
})

describe('diffSchemas', () => {
  it('같으면 빈 배열', () => {
    expect(diffSchemas(base(), base())).toEqual([])
  })

  it('nullable이 다르면 그 컬럼을 짚는다', () => {
    const b = base()
    b.columns['mail_jobs.subject'].nullable = 'YES'
    expect(diffSchemas(base(), b)).toEqual(['mail_jobs.subject: nullable NO ≠ YES'])
  })

  it('한쪽에만 있는 인덱스', () => {
    const b = base()
    b.indexes.idx_mail_jobs_hub = 'CREATE INDEX idx_mail_jobs_hub ON mail_jobs USING btree (hub_id)'
    expect(diffSchemas(base(), b)).toEqual(['index idx_mail_jobs_hub: B에만 있음'])
  })

  it('한쪽에만 있는 테이블·컬럼', () => {
    const b = base()
    b.tables.push('send_log')
    b.columns['mail_jobs.hub_id'] = { type: 'uuid', nullable: 'YES', default: null }
    expect(diffSchemas(base(), b)).toEqual(['mail_jobs.hub_id: B에만 있음', 'table send_log: B에만 있음'])
  })

  it('nextval 기본값의 스키마 접두사 차이는 무시', () => {
    const a = base()
    const b = base()
    a.columns['mail_jobs.n'] = { type: 'bigint', nullable: 'NO', default: "nextval('public.mail_jobs_n_seq'::regclass)" }
    b.columns['mail_jobs.n'] = { type: 'bigint', nullable: 'NO', default: "nextval('mail_jobs_n_seq'::regclass)" }
    expect(diffSchemas(a, b)).toEqual([])
  })
})
