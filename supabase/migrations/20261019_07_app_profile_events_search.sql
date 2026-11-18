-- Step 4: small additions the mobile app needs.
--  * update_my_household also saves the home GPS pin and the emergency contact number.
--  * get_public_map also lists active disaster declarations (resident alert banner).
--  * search_field_evacuees: rescuers' and staff's reunification lookup across residents,
--    household members and walk-ins (search_evacuees stays admin-only for the web).
-- Nothing is dropped or deleted.
begin;

create or replace function public.update_my_household(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_household uuid; v_lat numeric; v_lng numeric; v_contact text;
begin
  select household_id into v_household from public.households where head_uid = auth.uid() for update;
  if v_household is null then
    raise exception 'Only the household head can edit the household.';
  end if;
  if jsonb_typeof(p) is distinct from 'object' then
    raise exception 'Invalid household.';
  end if;
  if p ? 'gps_lat' or p ? 'gps_long' then
    v_lat := nullif(p->>'gps_lat', '')::numeric;
    v_lng := nullif(p->>'gps_long', '')::numeric;
    if v_lat is null or v_lng is null or v_lat not between -90 and 90 or v_lng not between -180 and 180 then
      raise exception 'Invalid home location.';
    end if;
  end if;
  if p ? 'emerg_contact_no' then
    v_contact := btrim(coalesce(p->>'emerg_contact_no', ''));
    if length(v_contact) > 20 or v_contact !~ '^[0-9+() -]*$' then
      raise exception 'Enter the emergency contact number using digits only.';
    end if;
  end if;
  update public.households set
    sitio = btrim(coalesce(p->>'sitio', sitio)),
    house_type = case when p ? 'house_type' then nullif(p->>'house_type', '') else house_type end,
    tenure = case when p ? 'tenure' then nullif(p->>'tenure', '') else tenure end,
    floor_level = case when p ? 'floor_level' then nullif(p->>'floor_level', '') else floor_level end,
    unit_no = btrim(coalesce(p->>'unit_no', unit_no)),
    updated_at = clock_timestamp(), updated_by = auth.uid()
  where household_id = v_household;
  if p ? 'sitio' then
    update public.residents set sitio = btrim(p->>'sitio') where uid = auth.uid();
  end if;
  if v_lat is not null then
    update public.residents set gps_lat = v_lat, gps_long = v_lng where uid = auth.uid();
  end if;
  if v_contact is not null then
    update public.residents set emerg_contact_no = v_contact where uid = auth.uid();
  end if;
  if p ? 'landmark' then
    update public.resident_profile_details set landmark = btrim(p->>'landmark'),
      updated_at = clock_timestamp(), updated_by = auth.uid()
    where resident_uid = auth.uid();
  end if;
  if p ? 'members' then
    perform public.sync_household_members(v_household, p->'members');
  end if;
  return public.household_members_json(v_household);
end;
$$;

create or replace function public.get_public_map()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'centers', (select coalesce(jsonb_agg(jsonb_build_object(
        'center_id', c.center_id, 'center_name', c.center_name, 'center_type', c.center_type,
        'latitude', c.gps_lat, 'longitude', c.gps_long, 'capacity', c.capacity, 'amenities', to_jsonb(c.amenities),
        'occupied', public.recorded_facility_occupancy(c.center_id)) order by c.center_name), '[]'::jsonb)
      from public.evacuation_centers c where c.status = 'active'),
    'hazards', (select coalesce(jsonb_agg(jsonb_build_object(
        'hazard_id', z.hazard_id, 'hazard_type', z.hazard_type, 'description', z.description,
        'latitude', z.latitude, 'longitude', z.longitude, 'barangay_id', z.barangay_id, 'created_at', z.created_at)
        order by z.created_at desc), '[]'::jsonb)
      from public.hazard_reports z where z.status = 'confirmed' and z.created_at > now() - interval '7 days'),
    'events', (select coalesce(jsonb_agg(jsonb_build_object(
        'event_id', e.event_id, 'name', e.name, 'hazard_type', e.hazard_type, 'barangay_id', e.barangay_id,
        'barangay_name', b.barangay_name, 'location_description', e.location_description, 'started_at', e.started_at)
        order by e.started_at desc), '[]'::jsonb)
      from public.disaster_events e join public.barangays b on b.barangay_id = e.barangay_id
      where e.status = 'active'))
  where public.is_active_user()
$$;

create or replace function public.search_field_evacuees(p_query text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare q text := lower(btrim(coalesce(p_query, ''))); result jsonb; n integer;
begin
  if not (public.is_active_rescuer() or public.is_active_staff()) then
    raise exception 'Only rescuers and staff can search evacuees.' using errcode = '42501';
  end if;
  if length(q) < 2 or length(q) > 100 then raise exception 'Type 2 to 100 letters of a name.'; end if;
  with people as (
    select 'resident' kind, r.uid::text id, concat_ws(' ', u.f_name, u.l_name) name, '' relationship,
           r.barangay_id, r.sitio, 1 headcount, le.evac_status, le.evac_center_id center_id,
           exists (select 1 from public.missing_person_reports mr where mr.resident_uid = r.uid and mr.status = 'missing') missing
    from public.residents r join public.users u on u.uid = r.uid
    left join lateral (select er.evac_status::text evac_status, er.evac_center_id from public.evacuation_records er
      where er.resident_uid = r.uid order by er.logged_at desc nulls last, er.record_id desc limit 1) le on true
    union all
    select 'member', m.member_id::text, m.full_name, m.relationship, h.barangay_id, h.sitio, 1,
           le.evac_status, le.center_id,
           exists (select 1 from public.missing_person_reports mr where mr.member_id = m.member_id and mr.status = 'missing')
    from public.household_members m join public.households h on h.household_id = m.household_id
    left join lateral public.member_latest_evacuation(m.member_id) le on true
    union all
    select 'walkin', er.record_id::text, er.walkin_name, '', er.barangay_id, er.walkin_sitio, er.headcount,
           er.evac_status::text, er.evac_center_id, false
    from public.evacuation_records er where er.walkin_name is not null
  ), hits as (
    select p.*, b.barangay_name, c.center_name from people p
    left join public.barangays b on b.barangay_id = p.barangay_id
    left join public.evacuation_centers c on c.center_id = p.center_id
    where position(q in lower(p.name)) > 0
      and (public.is_active_rescuer() or public.staff_can_access_barangay(p.barangay_id))
    order by (p.evac_status = 'safely_evacuated') desc nulls last, p.name
    limit 50
  )
  select count(*), coalesce(jsonb_agg(jsonb_build_object(
      'kind', kind, 'id', id, 'name', name, 'relationship', relationship, 'barangay_name', barangay_name,
      'sitio', sitio, 'headcount', headcount, 'evac_status', evac_status, 'center_name', center_name,
      'missing', missing) order by (evac_status = 'safely_evacuated') desc nulls last, name), '[]'::jsonb)
    into n, result from hits;
  insert into public.reunification_lookup_audit(actor_uid, lookup, query, result_count)
    values (auth.uid(), 'search', q, n);
  return result;
end;
$$;

revoke all on function public.search_field_evacuees(text) from public, anon;
grant execute on function public.search_field_evacuees(text) to authenticated;

notify pgrst, 'reload schema';

commit;
