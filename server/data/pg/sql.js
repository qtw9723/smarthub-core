// pg 구현 공용 — 컬럼 이름은 SQL에 그대로 들어가므로 반드시 허용 목록으로 거른 뒤에만 쓴다. 값은 항상 $n.

/** 허용 밖 키가 있으면 throw. */
export function assertColumns(keys, allowed, what) {
  const bad = keys.filter((k) => !allowed.includes(k))
  if (bad.length) throw new Error(`${what}: 허용되지 않은 컬럼 ${bad.join(', ')}`)
}

/** INSERT … RETURNING. row의 undefined 값은 뺀다(supabase-js와 같게 — 생략 = 기본값). */
export function insertSql(table, row, allowed, returning = '*') {
  const keys = Object.keys(row).filter((k) => row[k] !== undefined)
  assertColumns(keys, allowed, table)
  return {
    text: `insert into ${table} (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning ${returning}`,
    values: keys.map((k) => row[k]),
  }
}

/** UPDATE의 SET 절. offset은 앞에 쓴 파라미터 수(WHERE 값은 그 뒤 번호). */
export function setClause(patch, allowed, what, offset = 0) {
  const keys = Object.keys(patch).filter((k) => patch[k] !== undefined)
  assertColumns(keys, allowed, what)
  if (!keys.length) throw new Error(`${what}: 바꿀 컬럼이 없다`)
  return {
    text: keys.map((k, i) => `${k} = $${offset + i + 1}`).join(', '),
    values: keys.map((k) => patch[k]),
  }
}
