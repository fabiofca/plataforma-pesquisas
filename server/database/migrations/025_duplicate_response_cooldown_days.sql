alter table surveys
  add column if not exists duplicate_response_cooldown_days integer not null default 15;
