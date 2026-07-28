alter table reward_campaigns
  add column if not exists retry_unlock_enabled boolean not null default false;

alter table reward_campaigns
  add column if not exists retry_unlock_tasks_json jsonb not null default '[]'::jsonb;

alter table survey_responses
  add column if not exists reward_retry_count integer not null default 0;

alter table survey_responses
  add column if not exists reward_retry_unlock_pending boolean not null default false;

alter table survey_responses
  add column if not exists reward_retry_unlocked_at timestamptz;

alter table reward_spin_logs
  add column if not exists spin_attempt integer not null default 1;

alter table reward_spin_logs
  drop constraint if exists reward_spin_logs_response_id_key;

create unique index if not exists idx_reward_spin_logs_response_attempt
  on reward_spin_logs(response_id, spin_attempt);

create table if not exists reward_retry_task_clicks (
  id uuid primary key,
  response_id uuid not null references survey_responses(id) on delete cascade,
  campaign_id uuid not null references reward_campaigns(id) on delete cascade,
  task_id varchar(60) not null,
  clicked_at timestamptz not null default now(),
  unique (response_id, task_id)
);

create index if not exists idx_reward_retry_task_clicks_response
  on reward_retry_task_clicks(response_id);
