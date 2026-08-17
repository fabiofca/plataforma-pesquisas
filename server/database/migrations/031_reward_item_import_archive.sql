alter table reward_items
  add column if not exists archived_by_import boolean not null default false;

create index if not exists idx_reward_items_campaign_archived_by_import
  on reward_items(campaign_id, archived_by_import);
