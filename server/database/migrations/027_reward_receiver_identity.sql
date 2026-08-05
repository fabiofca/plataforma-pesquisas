alter table reward_campaigns
  add column if not exists require_receiver_identity boolean not null default false;

alter table reward_wins
  add column if not exists received_by varchar(150);
