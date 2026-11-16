// 모듈 보안 레벨 저장소(사내, pg).
import { query } from './pool.js'

export const list = async () => (await query('select module_key, level, reason, updated_at from hub_module_security')).rows

export async function upsert({ module_key, level, reason, updated_at }) {
  await query(`insert into hub_module_security (module_key, level, reason, updated_at) values ($1, $2, $3, $4)
    on conflict (module_key) do update set level = excluded.level, reason = excluded.reason, updated_at = excluded.updated_at`,
  [module_key, level, reason, updated_at])
}

export async function remove(moduleKey) {
  await query('delete from hub_module_security where module_key = $1', [moduleKey])
}
