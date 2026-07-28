create table if not exists survey_share_visits (
  id uuid primary key,
  survey_id uuid not null references surveys(id) on delete cascade,
  source varchar(20) not null,
  source_ip_hash varchar(128),
  user_agent text,
  referer text,
  visited_at timestamptz not null default now()
);

create index if not exists idx_survey_share_visits_survey_id on survey_share_visits(survey_id);
create index if not exists idx_survey_share_visits_source on survey_share_visits(source);
