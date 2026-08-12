alter table survey_attendants
  add column if not exists sort_order integer;

with ordered_attendants as (
  select
    id,
    row_number() over (partition by survey_id order by created_at asc, name asc) as next_sort_order
  from survey_attendants
)
update survey_attendants
set sort_order = ordered_attendants.next_sort_order
from ordered_attendants
where survey_attendants.id = ordered_attendants.id
  and survey_attendants.sort_order is null;

alter table survey_attendants
  alter column sort_order set not null;

create index if not exists idx_survey_attendants_survey_order
  on survey_attendants(survey_id, sort_order);
