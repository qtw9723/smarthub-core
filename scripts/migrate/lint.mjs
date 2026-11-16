// common 마이그레이션 린트 — 두 DB에 같이 적용되는 SQL에 Supabase 전용 문법이 섞였는지 본다.
//
// 주석과 작은따옴표 문자열은 같은 길이의 공백으로 지운 뒤 검사한다(줄 번호 보존).
// $$…$$ 본문은 지우지 않는다 — 함수 본문 안에서 cron.·net.을 부르는 것도 막아야 하기 때문이다.

const RULES = [
  { pattern: 'auth.', re: /\bauth\./gi },
  { pattern: 'storage.', re: /\bstorage\./gi },
  { pattern: 'cron.', re: /\bcron\./gi },
  { pattern: 'net.', re: /\bnet\./gi },
  { pattern: 'anon', re: /\banon\b/gi },
  { pattern: 'authenticated', re: /\bauthenticated\b/gi },
  { pattern: 'service_role', re: /\bservice_role\b/gi },
  // 일반 Postgres에도 있는 확장만 허용. gen_random_uuid()는 PG13+ 내장이라 확장이 필요 없다.
  {
    pattern: 'CREATE EXTENSION',
    re: /\bcreate\s+extension\s+(?:if\s+not\s+exists\s+)?("[^"]+"|[\w-]+)/gi,
    allow: (m) => ['pgcrypto', '"uuid-ossp"'].includes(m[1].toLowerCase()),
  },
]

const blank = (s) => s.replace(/[^\n]/g, ' ')

function stripCommentsAndStrings(sql) {
  let out = ''
  let i = 0
  while (i < sql.length) {
    const two = sql.slice(i, i + 2)
    let end
    if (two === '--') {
      end = sql.indexOf('\n', i)
      if (end < 0) end = sql.length
    } else if (two === '/*') {
      end = sql.indexOf('*/', i + 2)
      end = end < 0 ? sql.length : end + 2
    } else if (sql[i] === "'") {
      end = i + 1
      while (end < sql.length) {
        if (sql[end] === "'" && sql[end + 1] === "'") { end += 2; continue }
        if (sql[end] === "'") { end += 1; break }
        end += 1
      }
    } else {
      out += sql[i++]
      continue
    }
    out += blank(sql.slice(i, end))
    i = end
  }
  return out
}

// 러너가 파일마다 트랜잭션을 연다. 파일 안에서 트랜잭션을 끊거나(begin/commit/rollback) 트랜잭션 안에서 못 도는 문장
// (concurrently)을 쓰면, 일부만 적용되고 기록은 없는 상태가 된다 — 두 scope 모두 막는다.
// plpgsql 본문의 `begin`(뒤에 ;가 없다)과 `end;`는 걸리지 않는다.
const TX_RULES = [
  { pattern: 'BEGIN', re: /\b(?:begin|start\s+transaction)\s*;/gi },
  { pattern: 'COMMIT', re: /\bcommit\s*;/gi },
  { pattern: 'ROLLBACK', re: /\brollback\s*;/gi },
  { pattern: 'CONCURRENTLY', re: /\bconcurrently\b/gi },
]

/** @returns {{ ok: boolean, violations: { pattern: string, line: number }[] }} */
export function lintCommonSql(sql) {
  return scan(sql, RULES)
}

/** @returns {{ ok: boolean, violations: { pattern: string, line: number }[] }} */
export function lintTransactionControl(sql) {
  return scan(sql, TX_RULES)
}

function scan(sql, rules) {
  const code = stripCommentsAndStrings(sql)
  const violations = []
  for (const { pattern, re, allow } of rules) {
    for (const m of code.matchAll(re)) {
      if (allow?.(m)) continue
      violations.push({ pattern, index: m.index })
    }
  }
  violations.sort((a, b) => a.index - b.index)
  return {
    ok: violations.length === 0,
    violations: violations.map(({ pattern, index }) => ({ pattern, line: code.slice(0, index).split('\n').length })),
  }
}
