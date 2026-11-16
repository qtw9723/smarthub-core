// 앱 설정 저장소(사내, pg) — app_settings(key·value).
import { query } from './pool.js'

export async function get(key) {
  return (await query('select value from app_settings where key = $1', [key])).rows[0]?.value ?? null
}

export async function set(key, value) {
  await query(`insert into app_settings (key, value, updated_at) values ($1, $2, now())
    on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at`, [key, value])
}

export async function remove(key) {
  await query('delete from app_settings where key = $1', [key])
}
