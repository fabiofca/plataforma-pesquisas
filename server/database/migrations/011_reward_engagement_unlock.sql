alter table reward_campaigns
  add column if not exists retry_unlock_mode varchar(30) not null default 'instant';

alter table reward_campaigns
  add column if not exists google_review_url text;

alter table reward_campaigns
  add column if not exists instagram_url text;

alter table survey_responses
  add column if not exists reward_retry_unlock_pending boolean not null default false;

alter table survey_responses
  add column if not exists reward_retry_unlock_action varchar(30);

alter table survey_responses
  add column if not exists reward_retry_unlocked_at timestamptz;
