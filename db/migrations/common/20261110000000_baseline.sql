-- baseline (common) — SmartHub 소유 테이블 스키마. 빈 DB 전용(러너가 hubs가 이미 있으면 거부한다).
-- 외부(Supabase)·사내(자체 Postgres) 두 에디션이 같은 스키마에서 시작한다. RLS·정책은 external/ 쪽에만 있다.
create sequence hub_module_calls_id_seq as bigint;
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
alter sequence hub_module_calls_id_seq owned by hub_module_calls.id;
alter table hubs add constraint hubs_pkey PRIMARY KEY (id);
alter table hub_features add constraint hub_features_pkey PRIMARY KEY (hub_id, feature_key);
alter table hub_chatbots add constraint hub_chatbots_pkey PRIMARY KEY (id);
alter table hub_chatbot_settings add constraint hub_chatbot_settings_pkey PRIMARY KEY (hub_id);
alter table hub_chatbot_check_log add constraint hub_chatbot_check_log_pkey PRIMARY KEY (id);
alter table hub_module_calls add constraint hub_module_calls_pkey PRIMARY KEY (id);
alter table hub_module_security add constraint hub_module_security_pkey PRIMARY KEY (module_key);
alter table hubs add constraint hubs_key_key UNIQUE (key);
alter table hubs add constraint hubs_security_ack_level_check CHECK (((security_ack_level IS NULL) OR (security_ack_level = ANY (ARRAY['L0'::text, 'L1'::text, 'L2'::text, 'L3'::text]))));
alter table hub_module_security add constraint hub_module_security_level_check CHECK ((level = ANY (ARRAY['L0'::text, 'L1'::text, 'L2'::text, 'L3'::text])));
alter table hub_features add constraint hub_features_hub_id_fkey FOREIGN KEY (hub_id) REFERENCES hubs(id) ON DELETE CASCADE;
alter table hub_chatbots add constraint hub_chatbots_hub_id_fkey FOREIGN KEY (hub_id) REFERENCES hubs(id) ON DELETE CASCADE;
alter table hub_chatbot_settings add constraint hub_chatbot_settings_hub_id_fkey FOREIGN KEY (hub_id) REFERENCES hubs(id) ON DELETE CASCADE;
alter table hub_chatbot_check_log add constraint hub_chatbot_check_log_chatbot_id_fkey FOREIGN KEY (chatbot_id) REFERENCES hub_chatbots(id) ON DELETE CASCADE;
alter table hub_chatbot_check_log add constraint hub_chatbot_check_log_hub_id_fkey FOREIGN KEY (hub_id) REFERENCES hubs(id) ON DELETE CASCADE;
alter table hub_module_calls add constraint hub_module_calls_hub_id_fkey FOREIGN KEY (hub_id) REFERENCES hubs(id) ON DELETE CASCADE;
CREATE INDEX idx_hub_chatbots_hub ON hub_chatbots USING btree (hub_id, sort_order, created_at);
CREATE INDEX idx_hub_check_log_bot ON hub_chatbot_check_log USING btree (chatbot_id, checked_at DESC);
CREATE INDEX idx_hub_check_log_hub ON hub_chatbot_check_log USING btree (hub_id, checked_at DESC);
CREATE INDEX hub_module_calls_window_idx ON hub_module_calls USING btree (hub_id, feature_key, called_at DESC);
