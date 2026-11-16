-- STEP 16 (2026-11-04): when a household reports "We're leaving now" / "We've arrived" to an
-- evacuation center by itself, record every family member who is with them, not only the
-- account holder. Before, a family of 4 that self-evacuated counted as 1 person at the center
-- and in DROMIC.
-- The app now shows "Who is with you?" (the household's listed members, ticked by default)
-- and sends the ticked member ids. Each person gets their own evacuation record, the same way
-- a rescuer checks people in. A record with no rescuer (rescuer_uid null) means the person came
-- on their own; the web labels it that way.

-- 1. The screen needs the names of the household members.
create or replace function public.get_my_preemptive_evacuation()
returns jsonb language plpgsql stable security definer set search_path to '' as $function$
declare r public.residents; v_household uuid; v_latest public.preemptive_evacuation_logs; v_plan public.barangay_shelter_plans;
begin
  select * into r from public.residents where uid = auth.uid();
  if not found then raise exception 'Only registered residents can report evacuation status.'; end if;
  v_household := public.resident_household_id(auth.uid());
  select * into v_latest from public.preemptive_evacuation_logs l
    where l.resident_uid = auth.uid() order by l.logged_at desc, l.log_id desc limit 1;
  select * into v_plan from public.barangay_shelter_plans p where p.barangay_id = r.barangay_id;
  return jsonb_build_object(
    'latest', public.preemptive_log_json(v_latest),
    'household_size', 1 + (select count(*) from public.household_members m where m.household_id = v_household),
    'members', coalesce((select jsonb_agg(jsonb_build_object('member_id', m.member_id, 'full_name', m.full_name) order by m.full_name)
                         from public.household_members m where m.household_id = v_household), '[]'::jsonb),
    'active_event', (select jsonb_build_object('event_id', e.event_id, 'name', e.name, 'hazard_type', e.hazard_type)
                     from public.disaster_events e where e.barangay_id = r.barangay_id and e.status = 'active'
                     order by e.started_at desc limit 1),
    'centers', coalesce((select jsonb_agg(jsonb_build_object(
        'center_id', c.center_id, 'center_name', c.center_name, 'gps_lat', c.gps_lat, 'gps_long', c.gps_long,
        'capacity', c.capacity, 'assigned', c.center_id = v_plan.primary_center_id or c.center_id = any(coalesce(v_plan.alternate_center_ids, '{}')),
        'is_primary', c.center_id = v_plan.primary_center_id)
        order by (c.center_id = v_plan.primary_center_id) desc nulls last,
                 (c.center_id = any(coalesce(v_plan.alternate_center_ids, '{}'))) desc nulls last, c.center_name)
      from public.evacuation_centers c where coalesce(c.status, 'open') <> 'closed'), '[]'::jsonb));
end;
$function$;

-- 2. Reporting takes the ticked family members (p_member_ids). The old 6-input version is
--    removed so the app's call is not ambiguous.
drop function if exists public.report_my_preemptive_evacuation(text, text, integer, text, integer, text);

create or replace function public.report_my_preemptive_evacuation(p_status text, p_destination_type text, p_center_id integer,
  p_destination_address text, p_headcount integer, p_note text, p_member_ids uuid[] default null)
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare v_household uuid; v_center integer; v_count integer := p_headcount; v_barangay integer;
begin
  if not exists (select 1 from public.residents where uid = auth.uid()) then
    raise exception 'Only registered residents can report evacuation status.';
  end if;
  if not exists (select 1 from public.users where uid = auth.uid() and account_status = 'active') then
    raise exception 'This account is not active.';
  end if;
  v_household := public.resident_household_id(auth.uid());

  -- With a member list, the head count is the account holder plus the ticked members.
  if p_member_ids is not null then
    v_count := 1 + (select count(*) from public.household_members m
                    where m.household_id = v_household and m.member_id = any(p_member_ids))::integer;
  end if;

  -- Saves the household's report and the account holder's own center record.
  perform public.insert_preemptive_evacuation_log(auth.uid(), null, p_status, p_destination_type, p_center_id,
    p_destination_address, v_count, p_note, 'resident');

  -- One center record per ticked family member, with no rescuer (= came on their own).
  if p_destination_type = 'evacuation_center' and p_status in ('evacuating', 'arrived') and p_member_ids is not null then
    v_center := p_center_id;
    select barangay_id into v_barangay from public.residents where uid = auth.uid();
    insert into public.evacuation_records (member_id, barangay_id, rescuer_uid, evac_center_id, evac_status, evacuated_at, logged_at)
    select m.member_id, v_barangay, null, v_center,
           case when p_status = 'arrived' then 'safely_evacuated' else 'in_transit' end::public.evac_status_type,
           case when p_status = 'arrived' then clock_timestamp() end, clock_timestamp()
    from public.household_members m
    where m.household_id = v_household and m.member_id = any(p_member_ids);
  end if;

  return public.get_my_preemptive_evacuation();
end;
$function$;

revoke all on function public.report_my_preemptive_evacuation(text, text, integer, text, integer, text, uuid[]) from public;
grant execute on function public.report_my_preemptive_evacuation(text, text, integer, text, integer, text, uuid[]) to authenticated;
