// common 린트 CLI — CI가 db/migrations/common 전체를 검사한다. 위반이면 파일:줄과 함께 exit 1.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const CLI = resolve(process.cwd(), 'scripts/migrate/lint-cli.mjs')
const run = (dir) => spawnSync(process.execPath, [CLI, dir], { encoding: 'utf8' })

describe('lint-cli', () => {
  let dir
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'lint-')); mkdirSync(join(dir, 'common')) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('위반 파일이 있으면 exit 1과 파일:줄', () => {
    writeFileSync(join(dir, 'common', '20261110000000_a.sql'), 'select 1;\ngrant select on t to anon;\n')
    const r = run(join(dir, 'common'))
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('20261110000000_a.sql:2 anon')
  })

  it('정상 폴더는 exit 0', () => {
    writeFileSync(join(dir, 'common', '20261110000000_a.sql'), 'create table a (id int);')
    expect(run(join(dir, 'common')).status).toBe(0)
  })
})
