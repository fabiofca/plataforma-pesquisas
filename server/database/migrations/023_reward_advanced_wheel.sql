alter table reward_campaigns
  add column if not exists wheel_mode varchar(20) not null default 'standard';

alter table reward_campaigns
  add column if not exists final_spin_mode varchar(30) not null default 'allow_no_prize';

update reward_campaigns
set wheel_mode = 'standard'
where wheel_mode not in ('standard', 'advanced');

update reward_campaigns
set final_spin_mode = 'allow_no_prize'
where final_spin_mode not in ('allow_no_prize', 'guaranteed_prize');

alter table reward_items
  add column if not exists wheel_label varchar(150);

alter table reward_items
  add column if not exists image_url text;

alter table reward_items
  add column if not exists outcome_role varchar(20) not null default 'prize';

alter table reward_items
  add column if not exists show_on_wheel boolean not null default true;

alter table reward_items
  add column if not exists sort_order integer not null default 0;

update reward_items
set wheel_label = coalesce(nullif(trim(wheel_label), ''), title)
where wheel_label is null
   or trim(wheel_label) = '';

update reward_items
set outcome_role = case
  when is_visual_only = true then 'showcase'
  else 'prize'
end
where outcome_role not in ('prize', 'no_prize', 'showcase');

with ordered_items as (
  select id, row_number() over (partition by campaign_id order by created_at asc, id asc) as next_sort_order
  from reward_items
)
update reward_items
set sort_order = ordered_items.next_sort_order
from ordered_items
where reward_items.id = ordered_items.id
  and reward_items.sort_order = 0;
