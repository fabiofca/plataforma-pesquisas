alter table reward_spin_logs
  add column if not exists is_test_spin boolean not null default false;

alter table reward_wins
  add column if not exists is_test_win boolean not null default false;

update reward_spin_logs
set is_test_spin = survey_responses.is_test_response
from survey_responses
where survey_responses.id = reward_spin_logs.response_id
  and reward_spin_logs.is_test_spin = false;

update reward_wins
set is_test_win = survey_responses.is_test_response
from survey_responses
where survey_responses.id = reward_wins.response_id
  and reward_wins.is_test_win = false;

update reward_items
set quantity_awarded = coalesce(real_wins.total_real_wins, 0)
from (
  select reward_item_id, count(*)::integer as total_real_wins
  from reward_wins
  where is_test_win = false
  group by reward_item_id
) as real_wins
where reward_items.id = real_wins.reward_item_id;

update reward_items
set quantity_awarded = 0
where id not in (
  select distinct reward_item_id
  from reward_wins
  where is_test_win = false
);

create index if not exists idx_reward_spin_logs_is_test_spin
  on reward_spin_logs(is_test_spin);

create index if not exists idx_reward_wins_is_test_win
  on reward_wins(is_test_win);
