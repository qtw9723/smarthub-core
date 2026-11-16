-- mail_jobs의 anon 전체 허용 정책 제거 — baseline을 뜨다 발견(2026-11-09).
-- 정책 "readable"(anon, ALL, using true / with check true)은 구 mailer가 브라우저에서 anon 키로 직접 읽고 쓰던 시절의 잔재다.
-- anon 키는 브라우저 번들에 실려 나가므로, 이 정책이 있으면 누구나 Supabase REST로 메일 잡(수신자 목록 포함)을 읽고 고칠 수 있다.
-- 지금 SmartHub는 메일 잡을 서버(service role, RLS 우회)로만 다루고 클라이언트 코드는 mail_jobs를 직접 부르지 않는다.
drop policy if exists readable on mail_jobs;
