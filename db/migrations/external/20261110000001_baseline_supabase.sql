-- baseline (external) — 외부 DB(Supabase) 전용 부분. 외부 DB에는 이미 있으므로 --mark-applied로 기록만 한다.
-- 서버는 service role(RLS 우회)로만 접근한다. RLS는 anon 키(브라우저 번들에 실림)로 직접 읽고 쓰는 것을 막는다.

alter table grafana_log_entries enable row level security;
alter table grafana_log_type_runs enable row level security;
alter table grafana_log_types enable row level security;
alter table grafana_report_settings enable row level security;
alter table grafana_sources enable row level security;
alter table hub_chatbot_check_log enable row level security;
alter table hub_chatbot_settings enable row level security;
alter table hub_chatbots enable row level security;
alter table hub_features enable row level security;
alter table hub_module_calls enable row level security;
alter table hub_module_security enable row level security;
alter table hubs enable row level security;
alter table mail_jobs enable row level security;
alter table send_log enable row level security;
alter table sender_accounts enable row level security;

create policy readable on mail_jobs as permissive for all to anon using (true) with check (true);
