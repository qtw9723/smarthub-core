-- 앱 설정(키·값) — 백오피스 마스터 키 변경(2026-11-10). 값은 해시 등 서버만 읽는 것.
-- 'master_key_hash'가 있으면 서버 설정값(APP_PASSWORD) 대신 이것으로 마스터 키를 확인한다. 행을 지우면 다시 APP_PASSWORD.
create table if not exists app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
