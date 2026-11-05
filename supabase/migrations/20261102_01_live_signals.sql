-- Step 13: the app and the web hear about each other's changes as they happen.
-- Before this, the phone app listened live to only 4 tables and the web to SOS alerts on the map, so a
-- disaster declaration, a centre closing or a rescuer's ticket update showed up only after a timed
-- re-check or a manual Refresh, and rescuers never saw declared disasters at all.
--
-- live_signals holds one row per topic with the time something in it last changed. Triggers bump it,
-- and it is the only table clients listen to: it says *that* something changed, never *what*, so no
-- private data travels over the live channel and the existing RPCs (with their barangay scoping) do the
-- actual reading.
begin;

create table if not exists public.live_signals (
  topic text primary key,
  changed_at timestamptz not null default now()
);
alter table public.live_signals enable row level security;
revoke all on public.live_signals from anon, authenticated;
grant select on public.live_signals to authenticated;
drop policy if exists live_signals_read on public.live_signals;
create policy live_signals_read on public.live_signals for select to authenticated using (true);

create or replace function public.bump_live_signal()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.live_signals as s (topic, changed_at) values (tg_argv[0], clock_timestamp())
    on conflict (topic) do update set changed_at = excluded.changed_at;
  return null;
end;
$$;
revoke all on function public.bump_live_signal() from public, anon, authenticated;

-- One statement-level trigger per watched table: (table, topic).
do $t$
declare r record;
begin
  for r in select * from (values
      ('disaster_events', 'events'), ('evacuation_centers', 'centers'), ('barangay_shelter_plans', 'shelter_plans'),
      ('sos_alerts', 'sos'), ('dispatch_tickets', 'tickets'), ('rescue_units', 'units'),
      ('evacuation_records', 'evacuation'), ('hazard_reports', 'hazards'),
      ('missing_person_reports', 'missing'), ('preemptive_evacuation_logs', 'preemptive'),
      ('residents', 'residents'), ('verification_documents', 'residents'), ('users', 'accounts')) v(tbl, topic)
  loop
    execute format('drop trigger if exists live_signal on public.%I', r.tbl);
    execute format('create trigger live_signal after insert or update or delete on public.%I
                    for each statement execute function public.bump_live_signal(%L)', r.tbl, r.topic);
    insert into public.live_signals(topic) values (r.topic) on conflict do nothing;
  end loop;
end
$t$;

do $p$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                 and schemaname = 'public' and tablename = 'live_signals') then
    alter publication supabase_realtime add table public.live_signals;
  end if;
end
$p$;

-- Rescuer feed: same as step 12, plus the active disaster declarations.
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

commit;
