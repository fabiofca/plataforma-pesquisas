alter table reward_items
  add column if not exists grants_extra_spin boolean not null default false;

alter table survey_responses
  add column if not exists reward_retry_count integer not null default 0;
