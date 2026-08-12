alter table survey_responses
  add column if not exists reward_retry_returned_at timestamptz;
