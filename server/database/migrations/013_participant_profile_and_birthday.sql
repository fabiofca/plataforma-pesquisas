alter table survey_responses
  add column if not exists participant_birth_day smallint;

alter table survey_responses
  add column if not exists participant_birth_month smallint;

create index if not exists idx_survey_responses_birthday
  on survey_responses(participant_birth_month, participant_birth_day)
  where participant_birth_month is not null and participant_birth_day is not null;
