create table if not exists birthday_automation_settings (
  id uuid primary key,
  owner_user_id uuid not null unique references users(id) on delete cascade,
  is_enabled boolean not null default false,
  message_template text not null default 'Feliz aniversário, {{name}}! A equipe da {{brand_name}} deseja um dia maravilhoso para você.',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists birthday_message_dispatches (
  id uuid primary key,
  owner_user_id uuid not null references users(id) on delete cascade,
  survey_response_id uuid not null references survey_responses(id) on delete cascade,
  survey_id uuid not null references surveys(id) on delete cascade,
  dispatch_date date not null,
  participant_name text,
  participant_phone text not null,
  participant_email text,
  rendered_message text not null,
  status varchar(20) not null default 'queued',
  provider varchar(40),
  provider_message_id text,
  error_message text,
  queued_at timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_user_id, participant_phone, dispatch_date)
);

create index if not exists idx_birthday_dispatches_owner_date
  on birthday_message_dispatches(owner_user_id, dispatch_date desc);
