-- Add test_phones column to reward_campaigns
alter table reward_campaigns
  add column if not exists test_phones text[] default '{}';

-- Add is_test_response column to survey_responses
alter table survey_responses
  add column if not exists is_test_response boolean default false;
