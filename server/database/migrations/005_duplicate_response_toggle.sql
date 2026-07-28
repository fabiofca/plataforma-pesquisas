alter table surveys
  add column if not exists prevent_duplicate_responses boolean not null default true;
