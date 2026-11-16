// server/modules/grafana-reports/settings.js
// grafana_report_settings를 hub_id로 스코프. mailer는 같은 테이블의 id=1(cs) 행을 계속 사용.
import { repos } from '../../data/index.js'
import { withQueryDefaults } from './config.js'


// 허브 설정 행 조회. 없으면 기본값으로 생성 후 반환. metrics/log_queries는 비어 있으면 기본값으로 채움.
export async function getSettings(hubId) {
  const data = await repos.grafana.settings.getRow(hubId)
  if (data) return withQueryDefaults(data)
  return withQueryDefaults(await repos.grafana.settings.createRow(hubId))
}

// 제공된 필드만 저장(undefined 키는 건드리지 않음 — 부분 업데이트).
export async function saveSettings(hubId, fields) {
  const allowed = ['recipients', 'send_hour', 'enabled', 'log_lag_hours', 'metrics', 'log_queries', 'last_analysis', 'last_analysis_date', 'last_sent_date']
  const update = { updated_at: new Date().toISOString() }
  for (const k of allowed) if (fields[k] !== undefined) update[k] = fields[k]

  const data = await repos.grafana.settings.update(hubId, update)
  // 행이 없으면 이전처럼 오류(.single()이 PGRST116을 냈다).
  if (!data) throw new Error(`grafana_report_settings 행이 없다(hub ${hubId})`)
  return data
}
