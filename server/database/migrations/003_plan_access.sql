create table if not exists plans (
  id text primary key,
  code text not null unique,
  name text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists plan_features (
  plan_id text not null references plans(id) on delete cascade,
  feature_key text not null,
  is_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (plan_id, feature_key)
);

create table if not exists user_plan_subscriptions (
  id text primary key,
  user_id uuid not null references users(id) on delete cascade,
  plan_id text not null references plans(id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'canceled', 'expired')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists user_plan_subscriptions_active_idx
  on user_plan_subscriptions(user_id)
  where status = 'active' and ends_at is null;

insert into plans (id, code, name, description)
values ('plan_base', 'base', 'Plano Base', 'Plano inicial da plataforma com todos os recursos liberados.')
on conflict (code) do update
set
  name = excluded.name,
  description = excluded.description,
  updated_at = now();

insert into plan_features (plan_id, feature_key, is_enabled)
values
  ('plan_base', 'reports_export_csv', true),
  ('plan_base', 'reports_export_pdf', true),
  ('plan_base', 'survey_share_qr', true),
  ('plan_base', 'survey_share_tracking', true)
on conflict (plan_id, feature_key) do update
set
  is_enabled = excluded.is_enabled,
  updated_at = now();

insert into user_plan_subscriptions (id, user_id, plan_id, status, starts_at)
select
  'subscription_' || users.id,
  users.id,
  'plan_base',
  'active',
  now()
from users
where users.deleted_at is null
  and not exists (
    select 1
    from user_plan_subscriptions
    where user_plan_subscriptions.user_id = users.id
      and user_plan_subscriptions.status = 'active'
      and user_plan_subscriptions.ends_at is null
  );
