-- 외부(Supabase): anon 키로 auth_failures를 읽고 쓰지 못하게 — 서버는 service role이라 영향 없다.
alter table auth_failures enable row level security;
