-- Step 12: an SOS goes to the barangay where the person is, not where they are registered.
-- A resident visiting another barangay (or staying at a second house) used to have their SOS filed under
-- their home barangay, so the wrong admin got it and the admin where they actually were never saw it.
-- Now raise_sos files the alert under the barangay whose boundary contains the phone's GPS point, and keeps
-- the registered barangay as home_barangay_id. That barangay's admin dispatches it; the home barangay admin
-- sees it read-only ("your residents elsewhere"). No GPS, or a point outside Cordova: the home barangay.
-- The barangay is fixed when the SOS is raised, so a ticket never moves between boards.
begin;

-- Even-odd ray casting over a GeoJSON Polygon/MultiPolygon ([lng, lat] pairs, closed rings).
-- Holes are handled because every ring toggles the count.
create or replace function public.point_in_geojson(p_geom jsonb, p_lat numeric, p_lng numeric)
returns boolean language sql immutable set search_path = '' as $$
  with rings as (
    select row_number() over () as rid, ring
    from jsonb_array_elements(case p_geom->>'type'
           when 'Polygon' then jsonb_build_array(p_geom->'coordinates')
           when 'MultiPolygon' then p_geom->'coordinates' else '[]'::jsonb end) poly,
         jsonb_array_elements(poly) ring
  ), pts as (
    select rid, (pt->>0)::numeric as x, (pt->>1)::numeric as y, i
    from rings, jsonb_array_elements(ring) with ordinality q(pt, i)
  ), edges as (
    select x as xi, y as yi, lag(x) over w as xj, lag(y) over w as yj
    from pts window w as (partition by rid order by i)
  )
  select coalesce(count(*) filter (where yj is not null and (yi > p_lat) <> (yj > p_lat)
           and p_lng < case when yj <> yi then (xj - xi) * (p_lat - yi) / (yj - yi) + xi end) % 2 = 1, false)
  from edges
$$;

create or replace function public.barangay_at(p_lat numeric, p_lng numeric)
returns integer language sql stable security definer set search_path = '' as $$
  select b.barangay_id from public.barangays b
  where p_lat is not null and p_lng is not null and b.boundary is not null
    and public.point_in_geojson(b.boundary, p_lat, p_lng)
  order by b.barangay_id limit 1
$$;
grant execute on function public.barangay_at(numeric, numeric) to authenticated;

alter table public.sos_alerts add column if not exists home_barangay_id integer references public.barangays(barangay_id);
update public.sos_alerts a set home_barangay_id = r.barangay_id
  from public.residents r where r.uid = a.resident_uid and a.home_barangay_id is null;
create index if not exists sos_alerts_barangay_status on public.sos_alerts(barangay_id, status);
create index if not exists sos_alerts_home_barangay_status on public.sos_alerts(home_barangay_id, status);

-- The barangay where the alert was filed can read it too (the home barangay already could).
alter policy sos_alerts_read on public.sos_alerts
  using (resident_uid = auth.uid() or public.is_active_rescuer() or public.staff_can_access_resident(resident_uid)
         or public.staff_can_access_barangay(barangay_id));

create or replace function public.raise_sos(p_type text, p_lat numeric, p_lng numeric, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.residents; v_household uuid;
begin
  select * into r from public.residents where uid = auth.uid();
  if not found then raise exception 'Only registered residents can send an SOS.'; end if;
  if not exists (select 1 from public.users where uid = auth.uid() and account_status = 'active') then
    raise exception 'This account is not active.';
  end if;
  if upper(coalesce(p_type, '')) not in ('FLOOD', 'FIRE', 'MEDICAL', 'TRAPPED', 'OTHER') then
    raise exception 'Choose the type of emergency.';
  end if;
  if (p_lat is null) <> (p_lng is null) then raise exception 'Send both coordinates or neither.'; end if;
  -- One live SOS per resident: pressing again just returns the current one.
  if not exists (select 1 from public.sos_alerts where resident_uid = auth.uid() and status = 'active') then
    v_household := public.resident_household_id(auth.uid());
    insert into public.sos_alerts (resident_uid, household_id, barangay_id, home_barangay_id, alert_type, alert_level,
                                   latitude, longitude, headcount, note, status)
    values (auth.uid(), v_household, coalesce(public.barangay_at(p_lat, p_lng), r.barangay_id), r.barangay_id,
            upper(p_type), public.household_alert_level(auth.uid()),
            coalesce(p_lat, r.gps_lat), coalesce(p_lng, r.gps_long),
            1 + (select count(*) from public.household_members m where m.household_id = v_household),
            left(btrim(coalesce(p_note, '')), 500), 'active');
  end if;
  return public.get_my_sos();
end;
$$;

-- An SOS ticket belongs to the barangay the SOS was filed under, and may name a visiting resident.
create or replace function public.create_dispatch_ticket(p_barangay integer, p_event_id uuid, p_resident_uid uuid, p_subject text,
  p_source text, p_source_ref text, p_priority text, p_lat numeric, p_lng numeric, p_location_note text, p_instructions text,
  p_equipment text[], p_unit_id integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare t public.dispatch_tickets;
begin
  perform public.assert_disaster_admin(p_barangay);
  if p_barangay is null then raise exception 'Select a barangay.'; end if;
  if p_event_id is not null and not exists (select 1 from public.disaster_events e
      where e.event_id = p_event_id and e.barangay_id = p_barangay and e.status = 'active') then
    raise exception 'The linked disaster event must be active and in the same barangay.';
  end if;
  if p_source not in ('manual','sos','missing_report','triage') then raise exception 'Unknown ticket source.'; end if;
  if p_source = 'sos' and not exists (select 1 from public.sos_alerts a where a.alert_id::text = p_source_ref and a.barangay_id = p_barangay) then
    raise exception 'SOS alert was not found in this barangay.';
  end if;
  if p_resident_uid is not null
     and not exists (select 1 from public.residents r where r.uid = p_resident_uid and r.barangay_id = p_barangay)
     and not (p_source = 'sos' and exists (select 1 from public.sos_alerts a
                where a.alert_id::text = p_source_ref and a.resident_uid = p_resident_uid)) then
    raise exception 'The resident is not registered in this barangay.';
  end if;
  if p_source = 'missing_report' and not exists (select 1 from public.missing_person_reports m
      where m.report_id::text = p_source_ref and m.status = 'missing' and m.barangay_id = p_barangay) then
    raise exception 'Open missing-person report was not found in this barangay.';
  end if;
  if p_lat is null and p_lng is null and p_resident_uid is null and btrim(coalesce(p_location_note, '')) = '' then
    raise exception 'Give a location: a resident, map coordinates, or a location note.';
  end if;
  if (p_lat is null) <> (p_lng is null) then raise exception 'Provide both coordinates or neither.'; end if;
  if p_unit_id is not null and not exists (select 1 from public.rescue_units u where u.unit_id = p_unit_id and u.is_active) then
    raise exception 'Choose an active responder unit.';
  end if;
  insert into public.dispatch_tickets(barangay_id, event_id, resident_uid, subject, source, source_ref, priority,
      latitude, longitude, location_note, instructions, equipment, status, assigned_unit_id, created_by, assigned_at)
    values (p_barangay, p_event_id, p_resident_uid, btrim(p_subject), p_source, nullif(btrim(coalesce(p_source_ref, '')), ''), p_priority,
      p_lat, p_lng, btrim(coalesce(p_location_note, '')), btrim(coalesce(p_instructions, '')),
      array(select distinct btrim(x) from unnest(coalesce(p_equipment, '{}')) x where btrim(x) <> ''),
      case when p_unit_id is null then 'open' else 'assigned' end, p_unit_id, auth.uid(),
      case when p_unit_id is null then null else clock_timestamp() end)
    returning * into t;
  insert into public.dispatch_ticket_events(ticket_id, action, to_status, unit_id, actor_uid)
    values (t.ticket_id, 'created', 'open', null, auth.uid());
  if p_unit_id is not null then
    insert into public.dispatch_ticket_events(ticket_id, action, from_status, to_status, unit_id, actor_uid)
      values (t.ticket_id, 'assigned', 'open', 'assigned', p_unit_id, auth.uid());
  end if;
  return t.ticket_id;
exception when unique_violation then
  raise exception 'A live dispatch ticket already exists for this alert/report. Refresh the board.';
end;
$$;

create or replace function public.get_dispatch_board()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor_role text; actor_barangay integer;
begin
  perform public.assert_disaster_admin();
  select role::text, assigned_barangay_id into actor_role, actor_barangay from public.users where uid = auth.uid();
  return jsonb_build_object(
    'generated_at', clock_timestamp(),
    'is_super_admin', actor_role = 'super_admin',
    'barangays', (select coalesce(jsonb_agg(jsonb_build_object('barangay_id', s.barangay_id, 'barangay_name', s.barangay_name) order by s.barangay_name), '[]'::jsonb)
      from public.barangays s where actor_role = 'super_admin' or s.barangay_id = actor_barangay),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('event_id', e.event_id, 'barangay_id', e.barangay_id, 'name', e.name, 'hazard_type', e.hazard_type)
        order by e.declared_at desc), '[]'::jsonb)
      from public.disaster_events e where e.status = 'active' and (actor_role = 'super_admin' or e.barangay_id = actor_barangay)),
    -- Live tickets, plus tickets closed in the last 7 days.
    'tickets', (select coalesce(jsonb_agg(jsonb_build_object(
        'ticket_id', t.ticket_id, 'ticket_no', t.ticket_no, 'barangay_id', t.barangay_id, 'event_id', t.event_id,
        'resident_uid', t.resident_uid, 'subject', t.subject, 'source', t.source, 'source_ref', t.source_ref,
        'priority', t.priority, 'latitude', t.latitude, 'longitude', t.longitude, 'location_note', t.location_note,
        'instructions', t.instructions, 'equipment', to_jsonb(t.equipment), 'status', t.status,
        'assigned_unit_id', t.assigned_unit_id, 'created_at', t.created_at, 'assigned_at', t.assigned_at,
        'closed_at', t.closed_at, 'outcome_note', t.outcome_note,
        'created_by_name', (select concat_ws(' ', u.f_name, u.l_name) from public.users u where u.uid = t.created_by),
        'last_update', (select max(ev.recorded_at) from public.dispatch_ticket_events ev where ev.ticket_id = t.ticket_id)
      ) order by case t.priority when 'critical' then 0 when 'high' then 1 else 2 end, t.created_at), '[]'::jsonb)
      from public.dispatch_tickets t
      where (actor_role = 'super_admin' or t.barangay_id = actor_barangay)
        and (t.closed_at is null or t.closed_at > now() - interval '7 days')),
    -- Units are shared: any admin may assign any active unit (e.g. to borrow a team from another barangay).
    'units', (select coalesce(jsonb_agg(jsonb_build_object(
        'unit_id', un.unit_id, 'unit_name', un.unit_name, 'barangay_id', un.barangay_id,
        'capabilities', to_jsonb(un.capabilities), 'member_uids', to_jsonb(un.member_uids), 'is_active', un.is_active,
        'editable', actor_role = 'super_admin' or (un.barangay_id is not null and un.barangay_id = actor_barangay),
        'members', (select coalesce(jsonb_agg(jsonb_build_object('uid', u.uid, 'name', concat_ws(' ', u.f_name, u.l_name), 'contact_no', u.contact_no)
            order by u.l_name), '[]'::jsonb) from public.users u where u.uid = any(un.member_uids)),
        'live_tickets', (select count(*) from public.dispatch_tickets t where t.assigned_unit_id = un.unit_id
            and t.status in ('assigned','acknowledged','en_route','on_scene'))
      ) order by un.is_active desc, un.unit_name), '[]'::jsonb) from public.rescue_units un),
    'rescuers', (select coalesce(jsonb_agg(jsonb_build_object('uid', u.uid, 'name', concat_ws(' ', u.f_name, u.l_name)) order by u.l_name, u.f_name), '[]'::jsonb)
      from public.users u where u.role::text = 'rescuer' and u.account_status = 'active'),
    -- Intake: active SOS alerts filed in scope (by where the person is) and open missing reports with no live ticket yet.
    'intake_sos', (select coalesce(jsonb_agg(jsonb_build_object(
        'alert_id', a.alert_id, 'resident_uid', r.uid, 'resident_name', concat_ws(' ', u.f_name, u.l_name),
        'barangay_id', coalesce(a.barangay_id, r.barangay_id), 'barangay_name', b.barangay_name,
        'home_barangay_id', coalesce(a.home_barangay_id, r.barangay_id), 'home_barangay_name', hb.barangay_name,
        'alert_type', a.alert_type, 'alert_level', a.alert_level, 'created_at', a.created_at,
        'headcount', a.headcount, 'note', a.note,
        'latitude', coalesce(a.latitude, r.gps_lat), 'longitude', coalesce(a.longitude, r.gps_long)) order by a.alert_level desc, a.created_at), '[]'::jsonb)
      from public.sos_alerts a
      join public.residents r on r.uid = a.resident_uid
      join public.users u on u.uid = r.uid
      left join public.barangays b on b.barangay_id = coalesce(a.barangay_id, r.barangay_id)
      left join public.barangays hb on hb.barangay_id = coalesce(a.home_barangay_id, r.barangay_id)
      where coalesce(a.status, 'active') = 'active' and (actor_role = 'super_admin' or coalesce(a.barangay_id, r.barangay_id) = actor_barangay)
        and not exists (select 1 from public.dispatch_tickets t where t.source = 'sos' and t.source_ref = a.alert_id::text
          and t.status not in ('resolved','cancelled'))),
    -- Read-only for a barangay admin: their residents with an active SOS filed in another barangay.
    'away_sos', (select coalesce(jsonb_agg(jsonb_build_object(
        'alert_id', a.alert_id, 'resident_uid', a.resident_uid, 'resident_name', concat_ws(' ', u.f_name, u.l_name),
        'barangay_id', a.barangay_id, 'barangay_name', b.barangay_name,
        'alert_type', a.alert_type, 'alert_level', a.alert_level, 'created_at', a.created_at, 'headcount', a.headcount,
        'ticket_status', t.status, 'unit_name', un.unit_name) order by a.created_at), '[]'::jsonb)
      from public.sos_alerts a
      join public.users u on u.uid = a.resident_uid
      join public.barangays b on b.barangay_id = a.barangay_id
      left join lateral (select x.status, x.assigned_unit_id from public.dispatch_tickets x where x.source = 'sos'
          and x.source_ref = a.alert_id::text order by x.created_at desc limit 1) t on true
      left join public.rescue_units un on un.unit_id = t.assigned_unit_id
      where actor_role <> 'super_admin' and a.status = 'active'
        and a.home_barangay_id = actor_barangay and a.barangay_id <> actor_barangay),
    'intake_missing', (select coalesce(jsonb_agg(jsonb_build_object(
        'report_id', m.report_id, 'resident_uid', m.resident_uid, 'full_name', m.full_name, 'barangay_id', m.barangay_id,
        'last_seen_location', m.last_seen_location, 'last_seen_at', m.last_seen_at, 'reported_at', m.reported_at,
        'latitude', r.gps_lat, 'longitude', r.gps_long) order by m.reported_at), '[]'::jsonb)
      from public.missing_person_reports m
      left join public.residents r on r.uid = m.resident_uid
      where m.status = 'missing' and (actor_role = 'super_admin' or m.barangay_id = actor_barangay)
        and not exists (select 1 from public.dispatch_tickets t where t.source = 'missing_report' and t.source_ref = m.report_id::text
          and t.status not in ('resolved','cancelled')))
  );
end;
$$;

-- Rescuer feed: same as before, plus where a visiting resident is registered.
create or replace function public.get_rescuer_feed()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare my_units integer[];
begin
  if not (public.is_active_rescuer() or public.is_active_staff()) then
    raise exception 'Only rescuers and staff can open the field feed.' using errcode = '42501';
  end if;
  select coalesce(array_agg(unit_id), '{}') into my_units from public.rescue_units where auth.uid() = any(member_uids);
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
    'hazards', (select coalesce(jsonb_agg(jsonb_build_object(
        'hazard_id', z.hazard_id, 'hazard_type', z.hazard_type, 'description', z.description, 'status', z.status,
        'latitude', z.latitude, 'longitude', z.longitude, 'barangay_id', z.barangay_id, 'photo_path', z.photo_path,
        'reporter_role', z.reporter_role, 'created_at', z.created_at, 'reviewed_at', z.reviewed_at,
        'review_note', z.review_note) order by z.created_at desc), '[]'::jsonb)
      from public.hazard_reports z
      where z.status in ('unverified', 'under_review', 'confirmed') and z.created_at > now() - interval '7 days'),
    'centers', (select coalesce(jsonb_agg(jsonb_build_object(
        'center_id', c.center_id, 'center_name', c.center_name, 'center_type', c.center_type, 'status', c.status,
        'latitude', c.gps_lat, 'longitude', c.gps_long, 'capacity', c.capacity, 'amenities', to_jsonb(c.amenities),
        'occupied', public.recorded_facility_occupancy(c.center_id)) order by c.center_name), '[]'::jsonb)
      from public.evacuation_centers c where c.status = 'active')
  );
end;
$$;

-- Operational timeline: an SOS shows for the barangay it was filed in and for the home barangay.
-- Patched in place so the rest of the (long) function stays exactly as it is.
do $patch$
declare src text; old_from text; new_from text; old_where text; new_where text;
begin
  src := pg_get_functiondef('public.get_operational_timeline(timestamptz, timestamptz)'::regprocedure);
  old_from := $s$(select s.created_at, 'sos', 'SOS alert raised', concat_ws(' ', u.f_name, u.l_name), r.barangay_id,$s$;
  new_from := $s$(select s.created_at, 'sos', 'SOS alert raised', concat_ws(' ', u.f_name, u.l_name), coalesce(s.barangay_id, r.barangay_id),$s$;
  old_where := $s$  where s.created_at >= p_from and s.created_at < p_to
    and (actor_role = 'super_admin' or r.barangay_id = actor_barangay))$s$;
  new_where := $s$  where s.created_at >= p_from and s.created_at < p_to
    and (actor_role = 'super_admin' or r.barangay_id = actor_barangay or s.barangay_id = actor_barangay))$s$;
  if strpos(src, old_from) = 0 or strpos(src, old_where) = 0 then
    if strpos(src, new_from) > 0 and strpos(src, new_where) > 0 then return; end if; -- already patched
    raise exception 'get_operational_timeline has changed; the SOS section was not found.';
  end if;
  execute replace(replace(src, old_from, new_from), old_where, new_where);
end;
$patch$;

commit;
