-- baseline (external) — Supabase 전용 부분. 서버는 service role(RLS 우회)로만 접근하고,
-- RLS는 anon 키(브라우저 번들에 실림)로 직접 읽고 쓰는 것을 막는다.
alter table hub_chatbot_check_log enable row level security;
alter table hub_chatbot_settings enable row level security;
alter table hub_chatbots enable row level security;
alter table hub_features enable row level security;
alter table hub_module_calls enable row level security;
alter table hub_module_security enable row level security;
alter table hubs enable row level security;
