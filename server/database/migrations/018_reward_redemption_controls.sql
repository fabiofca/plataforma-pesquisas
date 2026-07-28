alter table reward_campaigns
  add column if not exists pickup_address text;

alter table reward_wins
  add column if not exists redemption_status varchar(20) not null default 'pending';

alter table reward_wins
  add column if not exists redemption_notes text;

alter table reward_wins
  add column if not exists redemption_updated_at timestamptz not null default now();

update reward_wins
set redemption_status = case
  when delivered_at is not null then 'delivered'
  else 'pending'
end
where redemption_status not in ('pending', 'delivered', 'cancelled');

create index if not exists idx_reward_wins_redemption_status
  on reward_wins(redemption_status);
