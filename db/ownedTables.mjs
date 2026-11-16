// SmartHub가 소유한 테이블 — 단일 출처.
// baseline 덤프·두 DB 스키마 비교(--diff)·baseline 보호(이미 테이블이 있는 DB에 baseline 실행 금지)가 이 목록만 본다.
// 새 테이블을 만들면 여기에도 넣는다. 첫 항목(hubs)은 baseline 보호의 판정 기준이다.
export const OWNED_TABLES = [
  'hubs',
  'hub_features',
  'hub_chatbots',
  'hub_chatbot_settings',
  'hub_chatbot_check_log',
  'hub_module_calls',
  'hub_module_security',
  'app_settings',
  'auth_failures',
]
