alter table reward_campaigns
  add column if not exists redemption_method varchar(30) not null default 'address_and_whatsapp';

update reward_campaigns
set redemption_method = 'address_and_whatsapp'
where redemption_method not in ('address_only', 'address_and_whatsapp');
