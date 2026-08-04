alter table surveys
  add column if not exists allow_multiple_responses boolean not null default true;
