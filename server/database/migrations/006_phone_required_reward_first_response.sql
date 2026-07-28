alter table surveys
  alter column participation_mode set default 'identified';

update surveys
set participation_mode = 'identified'
where participation_mode <> 'identified';

alter table surveys
  alter column prevent_duplicate_responses set default false;

update surveys
set prevent_duplicate_responses = false
where prevent_duplicate_responses = true;
