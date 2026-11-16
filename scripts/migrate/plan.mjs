// 마이그레이션 계획 — 파일 목록과 DB의 적용 기록(schema_migrations)을 맞대어 무엇을 적용할지 정한다.
// DB에 닿지 않는 순수 로직만 둔다(적용은 runner.mjs).
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const FILE_RE = /^(\d{14})_[\w-]+\.sql$/

/** 줄끝을 \n으로 맞춘 내용의 sha256 hex — 체크아웃 환경(CRLF)에 따라 "내용이 바뀌었다"로 헛울리지 않게. */
export function checksum(sql) {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex')
}

/**
 * @param {string} rootDir  db/migrations
 * @param {('common'|'external')[]} scopes
 * @returns {{ version: string, scope: string, file: string, sql: string }[]} 버전 오름차순
 */
export function readMigrations(rootDir, scopes) {
  const out = []
  for (const scope of scopes) {
    const dir = join(rootDir, scope)
    // 사내 버전 내보내기에서는 external 폴더가 빠진다 — 없으면 빈 목록.
    if (!existsSync(dir)) continue
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.sql')) continue
      const m = FILE_RE.exec(file)
      if (!m) throw new Error(`마이그레이션 파일명 형식이 아니다(<14자리 버전>_<이름>.sql): ${scope}/${file}`)
      out.push({ version: m[1], scope, file, sql: readFileSync(join(dir, file), 'utf8') })
    }
  }
  out.sort((a, b) => a.version.localeCompare(b.version))
  for (let i = 1; i < out.length; i++) {
    if (out[i].version === out[i - 1].version) {
      throw new Error(`중복 버전 ${out[i].version}: ${out[i - 1].scope}/${out[i - 1].file} · ${out[i].scope}/${out[i].file}`)
    }
  }
  return out
}

/**
 * @param {ReturnType<typeof readMigrations>} files
 * @param {{ version: string, scope: string, checksum: string }[]} applied
 */
export function planMigrations(files, applied) {
  const key = (x) => `${x.scope}/${x.version}`
  const appliedByKey = new Map(applied.map((a) => [key(a), a]))
  const fileKeys = new Set(files.map(key))
  const pending = []
  const mismatched = []
  for (const f of files) {
    const a = appliedByKey.get(key(f))
    if (!a) pending.push(f)
    else if (a.checksum !== checksum(f.sql)) mismatched.push({ version: f.version, scope: f.scope })
  }
  const unknown = applied.filter((a) => !fileKeys.has(key(a))).map(({ version, scope }) => ({ version, scope }))
  return { pending, mismatched, unknown }
}
