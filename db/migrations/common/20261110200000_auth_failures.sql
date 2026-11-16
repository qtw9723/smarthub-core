-- 로그인 실패 기록(마스터 키·허브 비밀번호) — 시도 제한용(server/lib/authThrottle.js, 2026-11-10 보안 검토).
-- client는 IP의 sha256 앞 32자(원문 IP 미저장). 하루 지난 행은 앱이 가끔 지운다.
create table if not exists auth_failures (
  id bigint generated always as identity primary key,
  scope text not null,
  client text not null,
  failed_at timestamptz not null default now()
);
create index if not exists auth_failures_lookup on auth_failures (scope, client, failed_at);
