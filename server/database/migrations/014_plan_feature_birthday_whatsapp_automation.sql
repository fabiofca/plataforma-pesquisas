insert into plan_features (plan_id, feature_key, is_enabled)
select plans.id, 'birthday_whatsapp_automation', false
from plans
where not exists (
  select 1
  from plan_features
  where plan_features.plan_id = plans.id
    and plan_features.feature_key = 'birthday_whatsapp_automation'
)
on conflict (plan_id, feature_key) do update
set
  is_enabled = excluded.is_enabled,
  updated_at = now();
