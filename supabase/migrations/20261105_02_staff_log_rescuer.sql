-- STEP 19 (2026-11-05): when barangay staff log on the web that someone arrived at (or is
-- going to) an evacuation center, they can say which rescuer brought them. That rescuer is
-- saved on the evacuation record, so the web shows "Rescued" instead of "Came on their own".
-- Leaving it empty means the person came on their own.
-- (When a rescuer logs it from the app, the rescuer is saved automatically, as before.)

drop function if exists public.log_preemptive_evacuation(uuid, uuid, text, text, integer, text, integer, text);

create or replace function public.log_preemptive_evacuation(p_resident_uid uuid, p_event_id uuid, p_status text,
  p_destination_type text, p_center_id integer, p_destination_address text, p_headcount integer, p_note text,
  p_rescuer_uid uuid default null)
returns uuid language plpgsql security definer set search_path to '' as $function$
declare v_rescuer boolean := public.is_active_rescuer(); v_id uuid; v_start timestamptz := clock_timestamp();
begin
  if p_resident_uid is null then raise exception 'Choose a resident.'; end if;
  if not (v_rescuer or public.staff_can_access_resident(p_resident_uid)) then
    raise exception 'Only rescuers and the resident''s barangay staff can log evacuation status.' using errcode = '42501';
  end if;
  if p_rescuer_uid is not null and not v_rescuer and not exists (
      select 1 from public.users u where u.uid = p_rescuer_uid and u.role::text = 'rescuer' and u.account_status = 'active') then
    raise exception 'Choose an active rescuer, or "On their own".';
  end if;

  v_id := public.insert_preemptive_evacuation_log(p_resident_uid, p_event_id, p_status, p_destination_type, p_center_id,
    p_destination_address, p_headcount, p_note, case when v_rescuer then 'rescuer' else 'staff' end);

  -- Staff named the rescuer who brought them: put it on the center record this call just made.
  if p_rescuer_uid is not null and not v_rescuer then
    update public.evacuation_records set rescuer_uid = p_rescuer_uid
    where resident_uid = p_resident_uid and evac_center_id is not null and rescuer_uid is null and logged_at >= v_start;
  end if;
  return v_id;
end;
$function$;
revoke all on function public.log_preemptive_evacuation(uuid, uuid, text, text, integer, text, integer, text, uuid) from public, anon;
grant execute on function public.log_preemptive_evacuation(uuid, uuid, text, text, integer, text, integer, text, uuid) to authenticated;
