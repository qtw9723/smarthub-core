// 두 DB 스키마 비교 — SmartHub 소유 테이블(db/ownedTables.mjs)의 컬럼·인덱스·제약만 본다.
// RLS·정책은 외부(Supabase) 전용이라 넣지 않는다. 스키마 이름(public 등)은 지워서 비교한다.
import { OWNED_TABLES } from '../../db/ownedTables.mjs'

/**
 * @typedef {{ tables: string[], columns: Record<string, { type: string, nullable: string, default: string|null }>,
 *   indexes: Record<string, string>, constraints: Record<string, string> }} Snapshot
 */

/** @returns {Promise<Snapshot>} 현재 search_path의 첫 스키마 기준 */
export async function describeSchema(client, tables = OWNED_TABLES) {
  const { rows: [{ schema }] } = await client.query('select current_schema() as schema')
  const strip = (s) => (s == null ? s : s.split(`${schema}.`).join(''))
  const present = (await client.query(
    'select table_name from information_schema.tables where table_schema = $1 and table_name = any($2) order by 1', [schema, tables],
  )).rows.map((r) => r.table_name)
  const columns = {}
  for (const r of (await client.query(
    `select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns
      where table_schema = $1 and table_name = any($2)`, [schema, tables],
  )).rows) {
    columns[`${r.table_name}.${r.column_name}`] = { type: r.data_type, nullable: r.is_nullable, default: strip(r.column_default) }
  }
  const indexes = {}
  for (const r of (await client.query(
    'select indexname, indexdef from pg_indexes where schemaname = $1 and tablename = any($2)', [schema, tables],
  )).rows) indexes[r.indexname] = strip(r.indexdef)
  const constraints = {}
  for (const r of (await client.query(
    `select c.relname as table_name, con.conname, pg_get_constraintdef(con.oid) as def
       from pg_constraint con join pg_class c on c.oid = con.conrelid join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = $1 and c.relname = any($2)`, [schema, tables],
  )).rows) constraints[`${r.table_name}.${r.conname}`] = strip(r.def)
  return { tables: present, columns, indexes, constraints }
}

const normDefault = (d) => (d == null ? d : d.replace(/nextval\('(?:[\w"]+\.)?([\w"]+)'::regclass\)/g, "nextval('$1'::regclass)"))

/** @returns {string[]} 사람이 읽는 차이 줄(빈 배열 = 같음) */
export function diffSchemas(a, b) {
  const out = []
  const onlyIn = (label, ka, kb) => {
    for (const k of ka) if (!kb.has(k)) out.push(`${label(k)}: A에만 있음`)
    for (const k of kb) if (!ka.has(k)) out.push(`${label(k)}: B에만 있음`)
  }
  const ca = new Set(Object.keys(a.columns))
  const cb = new Set(Object.keys(b.columns))
  onlyIn((k) => k, ca, cb)
  for (const k of [...ca].filter((x) => cb.has(x)).sort()) {
    const x = a.columns[k]
    const y = b.columns[k]
    if (x.type !== y.type) out.push(`${k}: type ${x.type} ≠ ${y.type}`)
    if (x.nullable !== y.nullable) out.push(`${k}: nullable ${x.nullable} ≠ ${y.nullable}`)
    if (normDefault(x.default) !== normDefault(y.default)) out.push(`${k}: default ${x.default} ≠ ${y.default}`)
  }
  onlyIn((k) => `table ${k}`, new Set(a.tables), new Set(b.tables))
  for (const [label, xa, xb] of [['index', a.indexes, b.indexes], ['constraint', a.constraints, b.constraints]]) {
    const ka = new Set(Object.keys(xa))
    const kb = new Set(Object.keys(xb))
    onlyIn((k) => `${label} ${k}`, ka, kb)
    for (const k of [...ka].filter((x) => kb.has(x)).sort()) {
      if (xa[k] !== xb[k]) out.push(`${label} ${k}: ${xa[k]} ≠ ${xb[k]}`)
    }
  }
  return out
}
