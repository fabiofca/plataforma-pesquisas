alter table reward_items
  add column if not exists is_visual_only boolean not null default false;
