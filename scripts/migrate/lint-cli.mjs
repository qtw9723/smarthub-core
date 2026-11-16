#!/usr/bin/env node
// common 마이그레이션 전체 린트 — `npm run lint:migrations`(CI). 인자로 폴더를 주면 그 폴더를 본다.
// Supabase 전용 문법이 섞이면 사내 빈 DB에서 처음 적용할 때 터진다 — 규칙은 lint.mjs.
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { lintCommonSql } from './lint.mjs'

const dir = process.argv[2] ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../db/migrations/common')
if (!existsSync(dir)) {
  console.error(`폴더가 없다: ${dir}`)
  process.exit(1)
}
let bad = 0
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
for (const f of files) {
  for (const v of lintCommonSql(readFileSync(join(dir, f), 'utf8')).violations) {
    console.error(`${f}:${v.line} ${v.pattern} — common에는 Supabase 전용 문법을 쓰지 않는다(external 폴더로)`)
    bad++
  }
}
if (bad) process.exit(1)
console.log(`common 마이그레이션 ${files.length}개 린트 통과`)
