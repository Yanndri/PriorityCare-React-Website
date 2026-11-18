-- STEP 24: show who reported a hazard (name, role, contact number) to responders and staff (2026-11-17).
-- Residents never get this: they only see confirmed hazards, without the reporter.
-- Staff and responders need it to verify a report (call the reporter), as the advisor's flow expects.
-- Run in the Supabase SQL Editor. Safe to run twice.

begin;

create or replace function public.get_hazard_reporters(p_ids uuid[])
returns table (hazard_id uuid, reporter_name text, reporter_role text, contact_no text)
language plpgsql
stable
security definer
set search_path to ''
as $$
begin
  if not (public.is_active_rescuer() or public.is_active_staff()) then
    raise exception 'Only responders and staff can see who reported a hazard.' using errcode = '42501';
  end if;
  return query
    select z.hazard_id, nullif(concat_ws(' ', u.f_name, u.l_name), ''), z.reporter_role, u.contact_no::text
      from public.hazard_reports z
      left join public.users u on u.uid = z.reported_by
     where z.hazard_id = any(p_ids)
       -- Staff see reporters only for hazards in barangays they handle; responders see all of Cordova.
       and (public.is_active_rescuer() or public.staff_can_access_barangay(z.barangay_id));
end;
$$;

revoke all on function public.get_hazard_reporters(uuid[]) from public, anon;
grant execute on function public.get_hazard_reporters(uuid[]) to authenticated;

commit;
