alter table surveys
  add column if not exists builder_mode varchar(20) not null default 'classic';

alter table surveys
  add column if not exists flow_json jsonb not null default '{"version":1,"nodes":[]}'::jsonb;

update surveys
set builder_mode = 'classic'
where builder_mode not in ('classic', 'visual');

update surveys
set flow_json = '{"version":1,"nodes":[]}'::jsonb
where flow_json is null;
