alter table survey_responses
  add column if not exists reward_spin_completed boolean not null default false;

alter table survey_responses
  add column if not exists reward_spin_item_id uuid references reward_items(id);
