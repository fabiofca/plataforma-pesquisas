alter table users add column if not exists is_default_master boolean not null default false;

with ranked_defaults as (
  select id, row_number() over (order by created_at asc, id asc) as position
  from users
  where is_default_master = true
    and deleted_at is null
)
update users
set is_default_master = false
where id in (select id from ranked_defaults where position > 1);

with current_default as (
  select id
  from users
  where is_default_master = true
    and deleted_at is null
  limit 1
),
candidate as (
  select users.id
  from users
  join roles on roles.id = users.role_id
  where roles.code = 'master'
    and users.deleted_at is null
  order by users.created_at asc, users.id asc
  limit 1
)
update users
set is_default_master = true
where id in (select id from candidate)
  and not exists (select 1 from current_default);

create unique index if not exists idx_users_single_default_master
  on users (is_default_master)
  where is_default_master = true and deleted_at is null;
