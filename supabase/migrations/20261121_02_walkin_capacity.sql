-- Walk-ins can no longer overfill an evacuation center.
-- admit_walk_in now locks the center (the same lock assign_evacuation_center takes), so two
-- check-ins at once can't both take the last spaces, and refuses a group bigger than the free
-- spaces: capacity minus people sheltered minus seats reserved for households on the way.
create or replace function public.admit_walk_in(p_center_id integer, p_name text, p_barangay_id integer,
  p_sitio text, p_headcount integer, p_needs text)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_rescuer boolean := public.is_active_rescuer();
  v_id uuid;
  v_center public.evacuation_centers;
  v_count integer := coalesce(p_headcount, 1);
  v_free integer;
begin
  if not (v_rescuer or public.is_active_staff()) then
    raise exception 'Only rescuers and staff can admit walk-ins.' using errcode = '42501';
  end if;
  if p_barangay_id is not null and not (v_rescuer or public.staff_can_access_barangay(p_barangay_id)) then
    raise exception 'You can only admit walk-ins from your barangay.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'Enter the name of the group''s contact person.'; end if;
  if p_center_id is null then raise exception 'Choose the evacuation center.'; end if;
  if v_count < 1 or v_count > 50 then raise exception 'Headcount must be 1 to 50 people.'; end if;

  select * into v_center from public.evacuation_centers where center_id = p_center_id for update;
  if not found then raise exception 'That evacuation center no longer exists.'; end if;
  if v_center.status <> 'active' then
    raise exception '% is not open right now. Choose another center.', v_center.center_name;
  end if;
  v_free := greatest(0, v_center.capacity - public.recorded_facility_occupancy(p_center_id)
                        - public.reserved_facility_slots(p_center_id));
  if v_count > v_free then
    raise exception '%', case when v_free = 0
      then format('%s is full. Choose another center.', v_center.center_name)
      else format('%s has only %s space%s left, not enough for %s people. Choose another center.',
                  v_center.center_name, v_free, case when v_free = 1 then '' else 's' end, v_count) end;
  end if;

  insert into public.evacuation_records (walkin_name, walkin_sitio, barangay_id, headcount, needs, rescuer_uid,
                                         evac_center_id, evac_status, evacuated_at, logged_at)
  values (btrim(p_name), btrim(coalesce(p_sitio, '')), p_barangay_id, v_count,
          btrim(coalesce(p_needs, '')), case when v_rescuer then auth.uid() end, p_center_id,
          'safely_evacuated', clock_timestamp(), clock_timestamp())
  returning record_id into v_id;
  return v_id;
end;
$function$;

revoke all on function public.admit_walk_in(integer, text, integer, text, integer, text) from public, anon;
grant execute on function public.admit_walk_in(integer, text, integer, text, integer, text) to authenticated;
