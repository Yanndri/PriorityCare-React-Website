-- STEP 25: a resident can have at most 3 hazard reports waiting to be checked at once (2026-11-17).
-- Stops spam or repeated misclicks without blocking anyone for good: as soon as a report is
-- confirmed, marked false, cleared or taken back, that slot is free again.
-- Responders and staff have no limit. Run in the Supabase SQL Editor. Safe to run twice.

begin;

create or replace function public.limit_resident_open_hazards()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if new.reporter_role = 'resident' and (
    select count(*) from public.hazard_reports
     where reported_by = new.reported_by and status in ('unverified', 'under_review')
  ) >= 3 then
    raise exception 'You already have 3 reports waiting to be checked. Wait for them to be checked, or take back one you sent by mistake (Hazards > My reports).';
  end if;
  return new;
end;
$$;

create or replace trigger limit_resident_open_hazards
  before insert on public.hazard_reports
  for each row execute function public.limit_resident_open_hazards();

commit;
