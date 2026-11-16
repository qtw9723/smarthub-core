-- baseline (common) — 외부 DB(Supabase, PostgreSQL 17.6)의 SmartHub 소유 테이블 16개 스키마를 2026-11-09에 떠서 만든 출발점.
-- 생성: Management API 읽기 전용 카탈로그 조회(pg_attribute·pg_constraint·pg_indexes) → DDL. 데이터는 없다.
-- 이 파일은 **빈 DB 전용**이다(러너가 hubs가 이미 있으면 거부). 외부 DB에는 실행하지 않고 --mark-applied로 기록만 한다.
-- 이전 이력(supabase/migrations/ 20개)은 이 파일로 대체된다 — 그쪽은 보관용.
--
-- 외부 DB와 다른 점(의도):
--   - RLS·정책 없음(외부 전용 → external/20261110000001_baseline_supabase.sql)
--   - hub_id의 cs 허브 기본값 3곳 없음(mail_jobs·sender_accounts·grafana_log_types) — 구 mailer 무중단용 잔재라
--     빈 DB에서는 FK 위반이 된다. 외부 DB에서는 external/20261110000002_drop_cs_hub_defaults.sql로 실제로 지워 맞춘다.
--   - 다른 프로젝트 함수(같은 Supabase 프로젝트의 cs·기타 앱)는 넣지 않는다. 소유 테이블에 트리거 없음.

create sequence hub_module_calls_id_seq as bigint;
create sequence grafana_report_settings_id_seq as smallint;

create table hubs (
  id uuid default gen_random_uuid() not null,
  key text not null,
  name text not null,
  enabled boolean default true not null,
  sort_order integer,
  created_at timestamp with time zone default now() not null,
  password_hash text,
  security_ack_level text
);

create table hub_features (
  hub_id uuid not null,
  feature_key text not null,
  enabled boolean default true not null,
  config jsonb default '{}'::jsonb not null,
  sort_order integer
);

create table hub_chatbots (
  id uuid default gen_random_uuid() not null,
  hub_id uuid not null,
  name text not null,
  url text not null,
  scenario jsonb default '[]'::jsonb not null,
  input_selector text,
  category text,
  enabled boolean default true not null,
  sort_order integer,
  created_at timestamp with time zone default now() not null
);

create table hub_chatbot_settings (
  hub_id uuid not null,
  recipients jsonb default '[]'::jsonb not null,
  categories jsonb default '[]'::jsonb not null,
  updated_at timestamp with time zone default now() not null
);

create table hub_chatbot_check_log (
  id bigint generated always as identity not null,
  chatbot_id uuid not null,
  hub_id uuid,
  ok boolean not null,
  detail text,
  duration_ms integer,
  checked_at timestamp with time zone default now() not null,
  attempts smallint
);

create table hub_module_calls (
  id bigint default nextval('hub_module_calls_id_seq'::regclass) not null,
  hub_id uuid not null,
  feature_key text not null,
  called_at timestamp with time zone default now() not null
);

create table hub_module_security (
  module_key text not null,
  level text not null,
  reason text,
  updated_at timestamp with time zone default now() not null
);

create table grafana_sources (
  id uuid default gen_random_uuid() not null,
  hub_id uuid not null,
  name text default '운영'::text not null,
  sort_order integer default 0 not null,
  base_url text,
  token text,
  prom_uid text,
  es_uid text,
  recipients jsonb default '[]'::jsonb not null,
  send_hour integer default 7 not null,
  enabled boolean default false not null,
  log_lag_hours integer,
  metrics jsonb default '[]'::jsonb not null,
  log_queries jsonb default '[]'::jsonb not null,
  last_analysis jsonb,
  last_analysis_date date,
  last_sent_date date,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  analysis_blocked_until timestamp with time zone,
  last_analysis_error text,
  last_analysis_error_at timestamp with time zone
);

create table grafana_report_settings (
  id smallint default nextval('grafana_report_settings_id_seq'::regclass) not null,
  recipients text[] default '{}'::text[] not null,
  send_hour smallint default 9 not null,
  enabled boolean default true not null,
  last_sent_date date,
  updated_at timestamp with time zone default now() not null,
  log_lag_hours smallint default 3 not null,
  metrics jsonb default '[]'::jsonb not null,
  log_queries jsonb default '[]'::jsonb not null,
  last_analysis jsonb,
  last_analysis_date date,
  hub_id uuid
);

create table grafana_log_types (
  id uuid default gen_random_uuid() not null,
  label text not null,
  description text,
  note text,
  total_count integer default 0 not null,
  last_seen_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  ai_note text,
  hub_id uuid,
  source_id uuid
);

create table grafana_log_type_runs (
  id bigint generated always as identity not null,
  type_id uuid not null,
  run_at timestamp with time zone not null,
  app text,
  count integer default 0 not null,
  logs jsonb default '[]'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  note text,
  matched_by text,
  run_date date default ((now() AT TIME ZONE 'Asia/Seoul'::text))::date not null
);

create table grafana_log_entries (
  id bigint generated always as identity not null,
  type_id uuid not null,
  run_id bigint not null,
  app text,
  occurred_at timestamp with time zone,
  msg text,
  created_at timestamp with time zone default now() not null
);

create table mail_jobs (
  id uuid default gen_random_uuid() not null,
  name text not null,
  subject text not null,
  body text not null,
  recipients text[] default '{}'::text[] not null,
  sender text not null,
  interval_minutes integer not null,
  is_active boolean default false not null,
  last_sent_at timestamp with time zone,
  send_count integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  use_index boolean default false not null,
  attachments jsonb default '[]'::jsonb not null,
  sort_order integer,
  sender_account_id uuid,
  hub_id uuid,
  body_format text default 'text'::text not null
);

create table send_log (
  id bigint generated always as identity not null,
  job_id uuid not null,
  ok boolean not null,
  error text,
  sent_at timestamp with time zone default now() not null
);

create table sender_accounts (
  id uuid default gen_random_uuid() not null,
  email text not null,
  app_password text not null,
  created_at timestamp with time zone default now(),
  hub_id uuid
);

alter sequence hub_module_calls_id_seq owned by hub_module_calls.id;
alter sequence grafana_report_settings_id_seq owned by grafana_report_settings.id;

alter table hubs add constraint hubs_pkey PRIMARY KEY (id);
alter table hub_features add constraint hub_features_pkey PRIMARY KEY (hub_id, feature_key);
alter table hub_chatbots add constraint hub_chatbots_pkey PRIMARY KEY (id);
alter table hub_chatbot_settings add constraint hub_chatbot_settings_pkey PRIMARY KEY (hub_id);
alter table hub_chatbot_check_log add constraint hub_chatbot_check_log_pkey PRIMARY KEY (id);
alter table hub_module_calls add constraint hub_module_calls_pkey PRIMARY KEY (id);
alter table hub_module_security add constraint hub_module_security_pkey PRIMARY KEY (module_key);
alter table grafana_sources add constraint grafana_sources_pkey PRIMARY KEY (id);
alter table grafana_report_settings add constraint grafana_report_settings_pkey PRIMARY KEY (id);
alter table grafana_log_types add constraint grafana_log_types_pkey PRIMARY KEY (id);
alter table grafana_log_type_runs add constraint grafana_log_type_runs_pkey PRIMARY KEY (id);
alter table grafana_log_entries add constraint grafana_log_entries_pkey PRIMARY KEY (id);
alter table mail_jobs add constraint mail_jobs_pkey PRIMARY KEY (id);
alter table send_log add constraint send_log_pkey PRIMARY KEY (id);
alter table sender_accounts add constraint sender_accounts_pkey PRIMARY KEY (id);
alter table hubs add constraint hubs_key_key UNIQUE (key);
alter table hubs add constraint hubs_security_ack_level_check CHECK (((security_ack_level IS NULL) OR (security_ack_level = ANY (ARRAY['L0'::text, 'L1'::text, 'L2'::text, 'L3'::text]))));
alter table hub_module_security add constraint hub_module_security_level_check CHECK ((level = ANY (ARRAY['L0'::text, 'L1'::text, 'L2'::text, 'L3'::text])));
alter table grafana_report_settings add constraint grafana_report_settings_log_lag_hours_check CHECK (((log_lag_hours >= 0) AND (log_lag_hours <= 24)));
alter table grafana_report_settings add constraint grafana_report_settings_send_hour_check CHECK (((send_hour >= 0) AND (send_hour <= 23)));
alter table mail_jobs add constraint mail_jobs_body_format_check CHECK ((body_format = ANY (ARRAY['text'::text, 'html'::text])));
alter table mail_jobs add constraint mail_jobs_interval_minutes_check CHECK ((interval_minutes >= 1));
alter table mail_jobs add constraint mail_jobs_sender_check CHECK ((sender = ANY (ARRAY['gmail'::text, 'ms'::text])));
alter table hub_features add constraint hub_features_hub_id_fkey FOREIGN KEY (hub_id) REFERENCES hubs(id) ON DELETE CASCADE;
alter table hub_chatbots add constraint hub_chatbots_hub_id_fkey FOREIGN KEY (hub_id) REFERENCES hubs(id) ON DELETE CASCADE;
alter table hub_chatbot_settings add constraint hub_chatbot_settings_hub_id_fkey FOREIGN KEY (hub_id) REFERENCES hubs(id) ON DELETE CASCADE;
alter table hub_chatbot_check_log add constraint hub_chatbot_check_log_chatbot_id_fkey FOREIGN KEY (chatbot_id) REFERENCES hub_chatbots(id) ON DELETE CASCADE;
alter table hub_chatbot_check_log add constraint hub_chatbot_check_log_hub_id_fkey FOREIGN KEY (hub_id) REFERENCES hubs(id) ON DELETE CASCADE;
alter table hub_module_calls add constraint hub_module_calls_hub_id_fkey FOREIGN KEY (hub_id) REFERENCES hubs(id) ON DELETE CASCADE;
alter table grafana_sources add constraint grafana_sources_hub_id_fkey FOREIGN KEY (hub_id) REFERENCES hubs(id) ON DELETE CASCADE;
alter table grafana_report_settings add constraint grafana_report_settings_hub_id_fkey FOREIGN KEY (hub_id) REFERENCES hubs(id) ON DELETE CASCADE;
alter table grafana_log_types add constraint grafana_log_types_hub_id_fkey FOREIGN KEY (hub_id) REFERENCES hubs(id) ON DELETE CASCADE;
alter table grafana_log_types add constraint grafana_log_types_source_id_fkey FOREIGN KEY (source_id) REFERENCES grafana_sources(id) ON DELETE CASCADE;
alter table grafana_log_type_runs add constraint grafana_log_type_runs_type_id_fkey FOREIGN KEY (type_id) REFERENCES grafana_log_types(id) ON DELETE CASCADE;
alter table grafana_log_entries add constraint grafana_log_entries_run_id_fkey FOREIGN KEY (run_id) REFERENCES grafana_log_type_runs(id) ON DELETE CASCADE;
alter table grafana_log_entries add constraint grafana_log_entries_type_id_fkey FOREIGN KEY (type_id) REFERENCES grafana_log_types(id) ON DELETE CASCADE;
alter table mail_jobs add constraint mail_jobs_hub_id_fkey FOREIGN KEY (hub_id) REFERENCES hubs(id) ON DELETE CASCADE;
alter table mail_jobs add constraint mail_jobs_sender_account_id_fkey FOREIGN KEY (sender_account_id) REFERENCES sender_accounts(id) ON DELETE SET NULL;
alter table send_log add constraint send_log_job_id_fkey FOREIGN KEY (job_id) REFERENCES mail_jobs(id) ON DELETE CASCADE;
alter table sender_accounts add constraint sender_accounts_hub_id_fkey FOREIGN KEY (hub_id) REFERENCES hubs(id) ON DELETE CASCADE;

CREATE INDEX idx_hub_chatbots_hub ON hub_chatbots USING btree (hub_id, sort_order, created_at);
CREATE INDEX idx_hub_check_log_bot ON hub_chatbot_check_log USING btree (chatbot_id, checked_at DESC);
CREATE INDEX idx_hub_check_log_hub ON hub_chatbot_check_log USING btree (hub_id, checked_at DESC);
CREATE INDEX hub_module_calls_window_idx ON hub_module_calls USING btree (hub_id, feature_key, called_at DESC);
CREATE INDEX idx_grafana_sources_hub ON grafana_sources USING btree (hub_id, sort_order);
CREATE UNIQUE INDEX uq_grafana_settings_hub ON grafana_report_settings USING btree (hub_id);
CREATE INDEX idx_grafana_log_types_hub ON grafana_log_types USING btree (hub_id);
CREATE INDEX idx_grafana_log_types_source ON grafana_log_types USING btree (source_id);
CREATE UNIQUE INDEX grafana_log_type_runs_daily_uniq ON grafana_log_type_runs USING btree (type_id, COALESCE(app, ''::text), run_date);
CREATE INDEX idx_grafana_log_type_runs ON grafana_log_type_runs USING btree (type_id, run_at DESC);
CREATE INDEX idx_gle_run ON grafana_log_entries USING btree (run_id);
CREATE INDEX idx_gle_type_time ON grafana_log_entries USING btree (type_id, occurred_at DESC);
CREATE INDEX idx_mail_jobs_hub ON mail_jobs USING btree (hub_id);
CREATE INDEX idx_send_log_job_sent ON send_log USING btree (job_id, sent_at DESC);
CREATE INDEX idx_sender_accounts_hub ON sender_accounts USING btree (hub_id);
