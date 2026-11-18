-- STEP 22: let a reporter take back their own hazard report (misclick or mistake), 2026-11-17.
-- Only the person who reported it, and only while nobody has confirmed it yet.
-- The row is kept (status 'dismissed', note "Withdrawn by the reporter") for the audit trail.
-- Run in the Supabase SQL Editor. Safe to run twice.

begin;

create or replace function public.withdraw_my_hazard(p_hazard_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare h public.hazard_reports;
begin
  select * into h from public.hazard_reports where hazard_id = p_hazard_id for update;
  if not found or h.reported_by is distinct from auth.uid() then
    raise exception 'You can only take back your own report.' using errcode = '42501';
  end if;
  if h.status not in ('unverified', 'under_review') or h.event_id is not null then
    raise exception 'This report was already checked, so it can no longer be taken back.';
  end if;
  update public.hazard_reports
     set status = 'dismissed', review_note = 'Withdrawn by the reporter (mistake)',
         reviewed_by = auth.uid(), reviewed_at = clock_timestamp(), updated_at = clock_timestamp()
   where hazard_id = p_hazard_id;
end;
$$;

revoke all on function public.withdraw_my_hazard(uuid) from public, anon;
grant execute on function public.withdraw_my_hazard(uuid) to authenticated;

commit;
