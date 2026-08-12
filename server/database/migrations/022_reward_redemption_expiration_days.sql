alter table reward_campaigns
  add column if not exists redemption_expiration_days integer not null default 15;

update reward_campaigns
set redemption_expiration_days = 15
where redemption_expiration_days is null
   or redemption_expiration_days <= 0;

alter table reward_wins
  add column if not exists redemption_expires_at timestamptz;

update reward_wins
set redemption_expires_at = reward_wins.awarded_at + make_interval(days => coalesce(reward_campaigns.redemption_expiration_days, 15))
from reward_campaigns
where reward_campaigns.id = reward_wins.campaign_id
  and reward_wins.redemption_expires_at is null;
