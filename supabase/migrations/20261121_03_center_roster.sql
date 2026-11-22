-- Who is inside an evacuation center, and checking people out, for the rescuer app.
--   get_center_roster(center)            -> everyone whose latest record puts them at the center,
--                                            with their household and special needs
--   check_out_evacuees(center, records)  -> marks those people "returned home" (history is kept)
-- Rescuers can use both for any center; barangay staff for centers in their barangay.

create or replace function public.can_manage_center_people(p_center_id integer)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select public.is_active_rescuer() or public.is_active_super_admin()
      or exists (select 1 from public.evacuation_centers c
                 where c.center_id = p_center_id and c.barangay_id is not null
                   and public.staff_can_access_barangay(c.barangay_id))
$function$;

create or replace function public.get_center_roster(p_center_id integer)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare v_center public.evacuation_centers; v_people jsonb;
begin
  select * into v_center from public.evacuation_centers where center_id = p_center_id;
  if not found then raise exception 'That evacuation center no longer exists.'; end if;
  if not public.can_manage_center_people(p_center_id) then
    raise exception 'Only rescuers and the center''s barangay staff can see who is inside.' using errcode = '42501';
  end if;

  with latest as (
    select distinct on (coalesce(e.resident_uid, e.member_id, e.record_id)) e.*
    from public.evacuation_records e
    order by coalesce(e.resident_uid, e.member_id, e.record_id), e.logged_at desc nulls last, e.record_id desc
  ), inside as (
    select l.* from latest l where l.evac_center_id = p_center_id and l.evac_status::text = 'safely_evacuated'
  ), people as (
    -- Registered residents
    select 'resident' kind, i.record_id, concat_ws(' ', u.f_name, u.l_name) name, 'Head' relationship,
           public.resident_household_id(r.uid) group_id, 1 headcount, r.barangay_id, r.sitio,
           case when r.birthdate is null then null
                when r.birthdate > (now() - interval '1 year')::date then 'infant'
                when r.birthdate > (now() - interval '18 years')::date then 'child'
                when r.birthdate <= (now() - interval '60 years')::date then 'senior' else 'adult' end age_group,
           case r.mobility_status::text when 'semi_ambulatory' then 'Needs help walking'
                                        when 'non_ambulatory' then 'Cannot walk' end mobility,
           false pregnant, null::text needs, coalesce(i.evacuated_at, i.logged_at) since
    from inside i join public.residents r on r.uid = i.resident_uid join public.users u on u.uid = r.uid
    union all
    -- Household members
    select 'member', i.record_id, m.full_name, coalesce(nullif(m.relationship, ''), 'Member'),
           m.household_id, 1, h.barangay_id, h.sitio, m.age_group,
           case m.mobility when 'assisted' then 'Needs help walking' when 'wheelchair' then 'Wheelchair'
                           when 'bedridden' then 'Bedridden' end,
           coalesce(m.is_pregnant, false), nullif(btrim(m.needs), ''), coalesce(i.evacuated_at, i.logged_at)
    from inside i join public.household_members m on m.member_id = i.member_id
    join public.households h on h.household_id = m.household_id
    union all
    -- Walk-in groups
    select 'walkin', i.record_id, i.walkin_name, 'Walk-in', null::uuid, coalesce(i.headcount, 1), i.barangay_id,
           i.walkin_sitio, null, null, false, nullif(btrim(i.needs), ''), coalesce(i.evacuated_at, i.logged_at)
    from inside i where i.resident_uid is null and i.member_id is null
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'kind', p.kind, 'record_id', p.record_id, 'name', p.name, 'relationship', p.relationship,
      'group_id', coalesce(p.group_id::text, p.record_id::text),
      'group_label', coalesce((select concat_ws(' ', hu.f_name, hu.l_name) from public.households hh
                                join public.users hu on hu.uid = hh.head_uid where hh.household_id = p.group_id), p.name),
      'headcount', p.headcount, 'barangay_name', b.barangay_name, 'sitio', nullif(btrim(p.sitio), ''),
      'age_group', p.age_group, 'mobility', p.mobility, 'pregnant', p.pregnant, 'needs', p.needs, 'since', p.since)
    order by p.since desc, p.name), '[]'::jsonb)
  into v_people
  from people p left join public.barangays b on b.barangay_id = p.barangay_id;

  return jsonb_build_object(
    'center_id', v_center.center_id, 'center_name', v_center.center_name, 'capacity', v_center.capacity,
    'occupied', public.recorded_facility_occupancy(p_center_id), 'reserved', public.reserved_facility_slots(p_center_id),
    'people', v_people);
end;
$function$;

create or replace function public.check_out_evacuees(p_center_id integer, p_record_ids uuid[])
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare v_id uuid; v_n integer := 0;
begin
  if not public.can_manage_center_people(p_center_id) then
    raise exception 'Only rescuers and the center''s barangay staff can check people out.' using errcode = '42501';
  end if;
  if p_record_ids is null or cardinality(p_record_ids) = 0 then raise exception 'Choose who is leaving.'; end if;
  if cardinality(p_record_ids) > 200 then raise exception 'Check out at most 200 people at a time.'; end if;
  -- Same lock as walk-ins and reservations, so the free-space count stays right.
  perform 1 from public.evacuation_centers where center_id = p_center_id for update;
  foreach v_id in array p_record_ids loop
    -- Only people whose latest record still puts them inside this center.
    v_n := v_n + public.mark_went_home(p_center_id, null, v_id);
  end loop;
  if v_n = 0 then raise exception 'Nobody you chose is still checked in here.'; end if;
  return v_n;
end;
$function$;

revoke all on function public.can_manage_center_people(integer) from public, anon, authenticated;
revoke all on function public.get_center_roster(integer) from public, anon;
revoke all on function public.check_out_evacuees(integer, uuid[]) from public, anon;
grant execute on function public.get_center_roster(integer) to authenticated;
grant execute on function public.check_out_evacuees(integer, uuid[]) to authenticated;
