// 마이그레이션 계획 — 파일 목록과 DB의 적용 기록을 맞대어 무엇을 적용할지 정한다(DB 접근 없음).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checksum, readMigrations, planMigrations } from './plan.mjs'

const f = (version, scope, sql = 'select 1;') => ({ version, scope, file: `${version}_x.sql`, sql })

describe('planMigrations', () => {
  it('미적용만 버전 순으로', () => {
    const files = [f('20261110000000', 'common'), f('20261111000000', 'external'), f('20261112000000', 'common')]
    const applied = [{ version: '20261110000000', scope: 'common', checksum: checksum('select 1;') }]
    expect(planMigrations(files, applied).pending.map((x) => x.version)).toEqual(['20261111000000', '20261112000000'])
  })

  it('적용된 파일 내용이 바뀌면 mismatched', () => {
    const r = planMigrations([f('20261110000000', 'common', 'select 2;')], [{ version: '20261110000000', scope: 'common', checksum: checksum('select 1;') }])
    expect(r.mismatched).toEqual([{ version: '20261110000000', scope: 'common' }])
    expect(r.pending).toEqual([])
  })

  it('기록만 있고 파일이 없으면 unknown', () => {
    expect(planMigrations([], [{ version: '20250101000000', scope: 'common', checksum: 'x' }]).unknown).toEqual([{ version: '20250101000000', scope: 'common' }])
  })
})

describe('checksum', () => {
  it('CRLF와 LF는 같은 체크섬', () => {
    expect(checksum('a\r\nb')).toBe(checksum('a\nb'))
  })
  it('내용이 다르면 다르다', () => {
    expect(checksum('a')).not.toBe(checksum('b'))
  })
})

describe('readMigrations', () => {
  let root
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mig-'))
    mkdirSync(join(root, 'common'))
    mkdirSync(join(root, 'external'))
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('고른 scope만, 버전 순으로', () => {
    writeFileSync(join(root, 'common', '20261112000000_b.sql'), 'select 2;')
    writeFileSync(join(root, 'common', '20261110000000_a.sql'), 'select 1;')
    writeFileSync(join(root, 'external', '20261111000000_x.sql'), 'select 3;')
    writeFileSync(join(root, 'common', 'README.md'), '무시')
    expect(readMigrations(root, ['common']).map((m) => m.file)).toEqual(['20261110000000_a.sql', '20261112000000_b.sql'])
    expect(readMigrations(root, ['common', 'external']).map((m) => [m.version, m.scope])).toEqual([
      ['20261110000000', 'common'], ['20261111000000', 'external'], ['20261112000000', 'common'],
    ])
  })

  it('형식 어긋난 파일명은 throw', () => {
    writeFileSync(join(root, 'common', 'abc.sql'), 'select 1;')
    expect(() => readMigrations(root, ['common'])).toThrow(/파일명/)
  })

  it('같은 버전이 두 scope에 있으면 throw', () => {
    writeFileSync(join(root, 'common', '20261110000000_a.sql'), 'select 1;')
    writeFileSync(join(root, 'external', '20261110000000_b.sql'), 'select 1;')
    expect(() => readMigrations(root, ['common', 'external'])).toThrow(/중복 버전/)
  })

  it('없는 scope 폴더는 빈 목록', () => {
    rmSync(join(root, 'external'), { recursive: true })
    expect(readMigrations(root, ['external'])).toEqual([])
  })
})
