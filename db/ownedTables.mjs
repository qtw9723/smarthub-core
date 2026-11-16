// SmartHub가 소유한 테이블 — 단일 출처.
//
// 외부 DB(Supabase)에는 같은 프로젝트에 cs 앱 테이블도 있어서, baseline 덤프(pg_dump -t)·두 DB 스키마 비교(--diff)·
// baseline 보호(이미 테이블이 있는 DB에 baseline 실행 금지)가 모두 이 목록만 본다. cs 앱 테이블은 읽지도 쓰지도 않는다.
// 메일러·Grafana 테이블은 구 mailer 앱 것을 hub_id로 나눠 쓰기 시작했지만 mailer가 2026-07-29 은퇴해 SmartHub 소유다.
//
// 새 테이블을 만들면 여기에도 넣는다. 첫 항목(hubs)은 baseline 보호의 판정 기준이다.
export const OWNED_TABLES = [
  'hubs',
  'hub_features',
  'hub_chatbots',
  'hub_chatbot_settings',
  'hub_chatbot_check_log',
  'hub_module_calls',
  'hub_module_security',
  'grafana_sources',
  'grafana_report_settings',
  'grafana_log_types',
  'grafana_log_type_runs',
  'grafana_log_entries',
  'mail_jobs',
  'send_log',
  'sender_accounts',
  'app_settings',
  'auth_failures',
]
