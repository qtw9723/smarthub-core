// 허브 저장소(사내, pg) — supabase 구현과 같은 함수·같은 결과(contract/hubs.db.test.js).
import { query } from './pool.js'
import { insertSql, setClause } from './sql.js'

const HUB_PATCH = ['name', 'enabled', 'sort_order']
const HUB_INSERT = ['key', 'name', 'password_hash', 'enabled', 'sort_order']
const isUuid = (v) => /^[0-9a-f-]{36}$/i.test(v)
const one = async (sql, params) => (await query(sql, params)).rows[0] ?? null

export const getHubByKey = (key) => one('select * from hubs where key = $1', [key])
export const getHubId = async (key) => (await one('select id from hubs where key = $1', [key]))?.id ?? null
export const getHubByIdOrKey = (idOrKey) => one(`select * from hubs where ${isUuid(idOrKey) ? 'id' : 'key'} = $1`, [idOrKey])
export const listHubs = async () => (await query('select * from hubs order by sort_order asc, created_at asc')).rows
export const listHubIdNames = async () => (await query('select id, key, name from hubs')).rows

export async function createHub(row) {
  const q = insertSql('hubs', row, HUB_INSERT)
  return (await query(q.text, q.values)).rows[0]
}

export async function updateHub(id, patch) {
  const set = setClause(patch, HUB_PATCH, 'updateHub')
  return one(`update hubs set ${set.text} where id = $${set.values.length + 1} returning *`, [...set.values, id])
}

export const setPasswordHash = (id, passwordHash) => one('update hubs set password_hash = $1 where id = $2 returning *', [passwordHash, id])
export const setSecurityAck = (id, level) => one('update hubs set security_ack_level = $1 where id = $2 returning *', [level, id])
export const deleteHub = async (id) => (await query('delete from hubs where id = $1', [id])).rowCount > 0
