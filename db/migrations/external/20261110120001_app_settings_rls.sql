-- 외부(Supabase): anon 키로 app_settings를 읽고 쓰지 못하게 — 서버는 service role이라 영향 없다.
alter table app_settings enable row level security;
