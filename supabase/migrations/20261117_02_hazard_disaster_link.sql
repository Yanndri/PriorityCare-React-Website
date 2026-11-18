-- STEP 21: hazards and disasters become one path (user decision 2026-11-17, "Yes, full link").
-- A hazard report is an alarm; the admin answers Yes/No; a confirmed flood/fire/landslide report
-- can be declared as a disaster in one click, and later reports of the same thing join it.
-- Ending the disaster clears every hazard tied to it.
-- Uses the existing hazard_reports.event_id column (FK to disaster_events, was unused). No tables added.
-- Run in the Supabase SQL Editor ("Run without RLS" is fine). Safe to run twice.

begin;

-- 1. Declare a disaster from a hazard report (pre-filled from the report: type, barangay, pin, time).
create or replace function public.declare_disaster_from_hazard(
  p_hazard_id uuid, p_name text, p_location text, p_notes text default '')
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare h public.hazard_reports; v_hazard text; v_event uuid;
begin
  select * into h from public.hazard_reports where hazard_id = p_hazard_id for update;
  if not found then raise exception 'Hazard report not found.'; end if;
  if h.event_id is not null then raise exception 'This report is already part of a declared disaster.'; end if;
  if h.status not in ('unverified', 'under_review', 'confirmed') then raise exception 'This report is already closed.'; end if;
  if h.barangay_id is null then raise exception 'This report has no barangay, so it cannot be declared.'; end if;
  v_hazard := case h.hazard_type when 'FLOOD' then 'flood' when 'FIRE' then 'fire' when 'LANDSLIDE' then 'landslide' end;
  if v_hazard is null then raise exception 'Only flood, fire and landslide reports can become a disaster.'; end if;
  -- declare_disaster_event checks that the caller may declare in this barangay and writes the audit row.
  v_event := public.declare_disaster_event(h.barangay_id, p_name, v_hazard, p_location,
    least(h.created_at, clock_timestamp()),
    concat_ws(E'\n', nullif(btrim(coalesce(p_notes, '')), ''), 'From an app hazard report: ' || coalesce(h.description, '')),
    h.latitude, h.longitude);
  update public.hazard_reports
     set event_id = v_event, status = 'confirmed',
         reviewed_by = coalesce(reviewed_by, auth.uid()), reviewed_at = coalesce(reviewed_at, clock_timestamp()),
         updated_at = clock_timestamp()
   where hazard_id = p_hazard_id;
  return v_event;
end;
$$;

-- 2. Add a report to a disaster that is already declared (repeat reports of the same flood).
create or replace function public.link_hazard_to_event(p_hazard_id uuid, p_event_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare h public.hazard_reports; e public.disaster_events;
begin
  select * into h from public.hazard_reports where hazard_id = p_hazard_id for update;
  if not found then raise exception 'Hazard report not found.'; end if;
  select * into e from public.disaster_events where event_id = p_event_id;
  if not found then raise exception 'Disaster not found.'; end if;
  if e.status <> 'active' then raise exception 'That disaster has already ended.'; end if;
  perform public.assert_disaster_admin(e.barangay_id);
  if h.status not in ('unverified', 'under_review', 'confirmed') then raise exception 'This report is already closed.'; end if;
  update public.hazard_reports
     set event_id = p_event_id, status = 'confirmed',
         reviewed_by = coalesce(reviewed_by, auth.uid()), reviewed_at = coalesce(reviewed_at, clock_timestamp()),
         updated_at = clock_timestamp()
   where hazard_id = p_hazard_id;
end;
$$;

revoke all on function public.declare_disaster_from_hazard(uuid, text, text, text) from public, anon;
revoke all on function public.link_hazard_to_event(uuid, uuid) from public, anon;
grant execute on function public.declare_disaster_from_hazard(uuid, text, text, text) to authenticated;
grant execute on function public.link_hazard_to_event(uuid, uuid) to authenticated;

-- 3. Ending a disaster clears the hazards tied to it.
create or replace function public.clear_hazards_of_resolved_event()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if new.status = 'resolved' and old.status is distinct from 'resolved' then
    update public.hazard_reports
       set status = 'resolved',
           review_note = left('Cleared when the disaster ended: ' || coalesce(new.resolution_reason, ''), 500),
           reviewed_by = coalesce(new.resolved_by, reviewed_by), reviewed_at = clock_timestamp(), updated_at = clock_timestamp()
     where event_id = new.event_id and status in ('unverified', 'under_review', 'confirmed');
  end if;
  return new;
end;
$$;

create or replace trigger clear_hazards_on_resolve
  after update of status on public.disaster_events
  for each row execute function public.clear_hazards_of_resolved_event();

-- 4. Maps: hazards carry event_id, and hazards of an active disaster stay listed past 7 days.
create or replace function public.get_public_map()
 returns jsonb
 language sql
 stable security definer
 set search_path to ''
as $function$
  select jsonb_build_object(
    'centers', (select coalesce(jsonb_agg(jsonb_build_object(
        'center_id', c.center_id, 'center_name', c.center_name, 'center_type', c.center_type,
        'latitude', c.gps_lat, 'longitude', c.gps_long, 'capacity', c.capacity, 'amenities', to_jsonb(c.amenities),
        'occupied', public.recorded_facility_occupancy(c.center_id)) order by c.center_name), '[]'::jsonb)
      from public.evacuation_centers c where c.status = 'active'),
    'hazards', (select coalesce(jsonb_agg(jsonb_build_object(
        'hazard_id', z.hazard_id, 'hazard_type', z.hazard_type, 'description', z.description,
        'latitude', z.latitude, 'longitude', z.longitude, 'barangay_id', z.barangay_id, 'created_at', z.created_at,
        'event_id', z.event_id)
        order by z.created_at desc), '[]'::jsonb)
      from public.hazard_reports z where z.status = 'confirmed'
        and (z.created_at > now() - interval '7 days'
             or exists (select 1 from public.disaster_events x where x.event_id = z.event_id and x.status = 'active'))),
    'events', (select coalesce(jsonb_agg(jsonb_build_object(
        'event_id', e.event_id, 'name', e.name, 'hazard_type', e.hazard_type, 'barangay_id', e.barangay_id,
        'barangay_name', b.barangay_name, 'location_description', e.location_description, 'latitude', e.latitude, 'longitude', e.longitude, 'started_at', e.started_at)
        order by e.started_at desc), '[]'::jsonb)
      from public.disaster_events e join public.barangays b on b.barangay_id = e.barangay_id
      where e.status = 'active'))
  where public.is_active_user()
$function$;

create or replace function public.get_rescuer_feed()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare my_units integer[];
begin
  if not (public.is_active_rescuer() or public.is_active_staff()) then
    raise exception 'Only rescuers and staff can open the field feed.' using errcode = '42501';
  end if;
  select coalesce(array_agg(unit_id), '{}') into my_units from public.rescue_unit_members where uid = auth.uid();
  return jsonb_build_object(
    'generated_at', clock_timestamp(),
    'me', (select jsonb_build_object('uid', u.uid, 'name', concat_ws(' ', u.f_name, u.l_name), 'role', u.role,
             'units', (select coalesce(jsonb_agg(jsonb_build_object('unit_id', un.unit_id, 'unit_name', un.unit_name,
                         'barangay_id', un.barangay_id, 'capabilities', to_jsonb(un.capabilities))), '[]'::jsonb)
                       from public.rescue_units un where un.unit_id = any(my_units)))
           from public.users u where u.uid = auth.uid()),
    -- Live tickets for my units, with what the team needs at the door.
    'tickets', (select coalesce(jsonb_agg(jsonb_build_object(
        'ticket_id', t.ticket_id, 'ticket_no', t.ticket_no, 'status', t.status, 'priority', t.priority,
        'subject', t.subject, 'source', t.source, 'instructions', t.instructions, 'equipment', to_jsonb(t.equipment),
        'latitude', coalesce(t.latitude, a.latitude, r.gps_lat), 'longitude', coalesce(t.longitude, a.longitude, r.gps_long),
        'location_note', t.location_note, 'barangay_name', b.barangay_name, 'unit_id', t.assigned_unit_id,
        'created_at', t.created_at, 'assigned_at', t.assigned_at,
        'sos', case when a.alert_id is null then null else jsonb_build_object('alert_type', a.alert_type,
          'alert_level', a.alert_level, 'headcount', a.headcount, 'note', a.note, 'status', a.status,
          'cancel_reason', a.cancel_reason, 'created_at', a.created_at,
          'visiting_from', (select hb.barangay_name from public.barangays hb
                            where hb.barangay_id = a.home_barangay_id and a.home_barangay_id <> a.barangay_id)) end,
        'resident', case when r.uid is null then null else jsonb_build_object('uid', r.uid,
          'name', concat_ws(' ', u.f_name, u.l_name), 'contact_no', u.contact_no,
          'sitio', r.sitio, 'landmark', d.landmark, 'address', d.address, 'house_photo_path', r.house_photo_url,
          'household', jsonb_build_object('household_id', h.household_id, 'house_type', h.house_type,
            'floor_level', h.floor_level, 'unit_no', h.unit_no,
            'people', public.household_people_json(h.household_id, coalesce(h.head_uid, r.uid)))) end
      ) order by case t.priority when 'critical' then 0 when 'high' then 1 else 2 end, t.created_at), '[]'::jsonb)
      from public.dispatch_tickets t
      join public.barangays b on b.barangay_id = t.barangay_id
      left join public.sos_alerts a on t.source = 'sos' and a.alert_id::text = t.source_ref
      left join public.residents r on r.uid = coalesce(t.resident_uid, a.resident_uid)
      left join public.users u on u.uid = r.uid
      left join public.resident_profile_details d on d.resident_uid = r.uid
      left join public.households h on h.household_id = coalesce(a.household_id, public.resident_household_id(r.uid))
      where t.assigned_unit_id = any(my_units) and t.status in ('assigned', 'acknowledged', 'en_route', 'on_scene')),
    -- Every active SOS (for the map), with its ticket state if one exists.
    'active_sos', (select coalesce(jsonb_agg(jsonb_build_object(
        'alert_id', a.alert_id, 'alert_type', a.alert_type, 'alert_level', a.alert_level, 'headcount', a.headcount,
        'latitude', a.latitude, 'longitude', a.longitude, 'barangay_id', a.barangay_id, 'created_at', a.created_at,
        'resident_name', concat_ws(' ', u.f_name, u.l_name), 'sitio', r.sitio,
        'home_barangay_id', a.home_barangay_id,
        'visiting_from', (select hb.barangay_name from public.barangays hb
                          where hb.barangay_id = a.home_barangay_id and a.home_barangay_id <> a.barangay_id),
        'ticket_status', (select x.status from public.dispatch_tickets x where x.source = 'sos'
                          and x.source_ref = a.alert_id::text order by x.created_at desc limit 1)
      ) order by a.alert_level desc, a.created_at), '[]'::jsonb)
      from public.sos_alerts a join public.residents r on r.uid = a.resident_uid join public.users u on u.uid = r.uid
      where a.status = 'active'),
    -- Active disaster declarations anywhere in Cordova (rescuers help across barangays).
    'events', (select coalesce(jsonb_agg(jsonb_build_object(
        'event_id', e.event_id, 'name', e.name, 'hazard_type', e.hazard_type, 'barangay_id', e.barangay_id,
        'barangay_name', b.barangay_name, 'location_description', e.location_description,
        'latitude', e.latitude, 'longitude', e.longitude, 'started_at', e.started_at, 'declared_at', e.declared_at)
        order by e.declared_at desc), '[]'::jsonb)
      from public.disaster_events e join public.barangays b on b.barangay_id = e.barangay_id
      where e.status = 'active'),
    'hazards', (select coalesce(jsonb_agg(jsonb_build_object(
        'hazard_id', z.hazard_id, 'hazard_type', z.hazard_type, 'description', z.description, 'status', z.status,
        'latitude', z.latitude, 'longitude', z.longitude, 'barangay_id', z.barangay_id, 'photo_path', z.photo_path,
        'reporter_role', z.reporter_role, 'created_at', z.created_at, 'reviewed_at', z.reviewed_at,
        'review_note', z.review_note, 'event_id', z.event_id) order by z.created_at desc), '[]'::jsonb)
      from public.hazard_reports z
      where z.status in ('unverified', 'under_review', 'confirmed')
        and (z.created_at > now() - interval '7 days'
             or exists (select 1 from public.disaster_events x where x.event_id = z.event_id and x.status = 'active'))),
    'centers', (select coalesce(jsonb_agg(jsonb_build_object(
        'center_id', c.center_id, 'center_name', c.center_name, 'center_type', c.center_type, 'status', c.status,
        'latitude', c.gps_lat, 'longitude', c.gps_long, 'capacity', c.capacity, 'amenities', to_jsonb(c.amenities),
        'occupied', public.recorded_facility_occupancy(c.center_id)) order by c.center_name), '[]'::jsonb)
      from public.evacuation_centers c where c.status = 'active')
  );
end;
$function$;

commit;
