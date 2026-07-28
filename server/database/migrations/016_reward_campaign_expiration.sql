alter table reward_campaigns
  add column if not exists expires_at date;
