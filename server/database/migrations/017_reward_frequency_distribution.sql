alter table reward_campaigns
  add column if not exists status varchar(20) not null default 'active';

update reward_campaigns
set status = case
  when is_active = true then 'active'
  else 'paused'
end
where status not in ('active', 'paused', 'ended');

alter table reward_campaigns
  add column if not exists spin_count integer not null default 0;

alter table reward_campaigns
  add column if not exists last_winning_spin integer not null default 0;

alter table reward_items
  add column if not exists frequency_mode varchar(20) not null default 'balanced';

alter table reward_items
  add column if not exists frequency_target integer not null default 60;

alter table reward_items
  add column if not exists next_release_spin integer not null default 0;

alter table reward_items
  add column if not exists last_awarded_spin integer not null default 0;

alter table reward_items
  add column if not exists min_gap_spins integer not null default 5;

create table if not exists reward_spin_logs (
  id uuid primary key,
  campaign_id uuid not null references reward_campaigns(id) on delete cascade,
  response_id uuid not null unique references survey_responses(id) on delete cascade,
  reward_item_id uuid references reward_items(id),
  outcome_type varchar(20) not null,
  wheel_label varchar(150) not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_reward_spin_logs_campaign_id
  on reward_spin_logs(campaign_id);

create index if not exists idx_reward_spin_logs_created_at
  on reward_spin_logs(created_at desc);
