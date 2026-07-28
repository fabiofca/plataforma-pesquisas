create table if not exists roles (
  id uuid primary key,
  code varchar(30) not null unique,
  name varchar(80) not null,
  created_at timestamptz not null default now()
);

create table if not exists users (
  id uuid primary key,
  role_id uuid not null references roles(id),
  name varchar(150) not null,
  email varchar(180) not null unique,
  password_hash varchar(255) not null,
  status varchar(20) not null default 'active',
  phone varchar(30),
  last_login_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists surveys (
  id uuid primary key,
  owner_user_id uuid not null references users(id),
  title varchar(180) not null,
  description text,
  status varchar(20) not null default 'draft',
  participation_mode varchar(20) not null default 'anonymous',
  brand_name varchar(120) not null,
  logo_url text,
  primary_color varchar(20) not null default '#0f172a',
  banner_url text,
  closing_message text,
  reward_enabled boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists survey_questions (
  id uuid primary key,
  survey_id uuid not null references surveys(id) on delete cascade,
  title text not null,
  description text,
  type varchar(30) not null,
  is_required boolean not null default false,
  position integer not null,
  settings_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists question_options (
  id uuid primary key,
  question_id uuid not null references survey_questions(id) on delete cascade,
  label varchar(180) not null,
  value varchar(180) not null,
  position integer not null,
  created_at timestamptz not null default now()
);

create table if not exists survey_responses (
  id uuid primary key,
  survey_id uuid not null references surveys(id) on delete cascade,
  participant_name varchar(150),
  participant_email varchar(180),
  participant_phone varchar(30),
  source_ip_hash varchar(128),
  browser_fingerprint varchar(180),
  browser_cookie_id varchar(180),
  reward_eligible boolean not null default false,
  submitted_at timestamptz not null default now()
);

create table if not exists response_answers (
  id uuid primary key,
  response_id uuid not null references survey_responses(id) on delete cascade,
  question_id uuid not null references survey_questions(id) on delete cascade,
  answer_text text,
  answer_json jsonb,
  created_at timestamptz not null default now()
);

create table if not exists reward_campaigns (
  id uuid primary key,
  survey_id uuid not null unique references surveys(id) on delete cascade,
  is_active boolean not null default false,
  require_identification boolean not null default true,
  distribution_mode varchar(30) not null default 'simple',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists reward_items (
  id uuid primary key,
  campaign_id uuid not null references reward_campaigns(id) on delete cascade,
  title varchar(150) not null,
  description text,
  quantity_total integer not null,
  quantity_awarded integer not null default 0,
  odds_weight integer not null default 1,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists reward_wins (
  id uuid primary key,
  campaign_id uuid not null references reward_campaigns(id) on delete cascade,
  reward_item_id uuid not null references reward_items(id),
  response_id uuid not null unique references survey_responses(id) on delete cascade,
  coupon_code varchar(64) not null unique,
  awarded_at timestamptz not null default now(),
  delivered_at timestamptz
);

create table if not exists survey_slugs (
  id uuid primary key,
  survey_id uuid not null unique references surveys(id) on delete cascade,
  slug varchar(160) not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id uuid primary key,
  actor_user_id uuid references users(id),
  survey_id uuid references surveys(id),
  action varchar(120) not null,
  entity_type varchar(80) not null,
  entity_id varchar(80) not null,
  meta_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists system_settings (
  id uuid primary key,
  setting_key varchar(120) not null unique,
  setting_value jsonb not null default '{}'::jsonb,
  updated_by uuid references users(id),
  updated_at timestamptz not null default now()
);

create index if not exists idx_surveys_owner_user_id on surveys(owner_user_id);
create index if not exists idx_questions_survey_id on survey_questions(survey_id);
create index if not exists idx_responses_survey_id on survey_responses(survey_id);
create index if not exists idx_answers_response_id on response_answers(response_id);
create index if not exists idx_reward_items_campaign_id on reward_items(campaign_id);
create index if not exists idx_audit_logs_actor_user_id on audit_logs(actor_user_id);
create index if not exists idx_audit_logs_survey_id on audit_logs(survey_id);
create index if not exists idx_system_settings_key on system_settings(setting_key);
