-- =====================================================================
-- Live rescue tracking, proximity alerts and evacuation center
-- assignment with capacity reservations.
--
-- Adds (nothing existing is dropped or renamed):
--   * rescue_unit_locations   latest GPS fix per rescue unit (realtime, RLS)
--   * rescue_location_trail   every accepted GPS fix (mission history)
--   * evacuation_reservations seats held at a center for a rescue mission
--   * dispatch_tickets        proximity stage + located / arrived timestamps
--   * RPCs: report_unit_location, get_my_rescue_tracking, get_mission_status,
--           confirm_resident_located, assign_evacuation_center,
--           release_evacuation_reservation, confirm_evacuation_arrival,
--           get_center_availability
--
-- Capacity rule:  available = capacity - recorded occupancy - active reservations
-- Reservations are made while every active center row is locked (FOR UPDATE,
-- always in center_id order), so two missions can never take the same last seats.
-- =====================================================================

-- ---------- helpers ----------
create or replace function public.geo_distance_m(lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric)
returns double precision language sql immutable set search_path to '' as $$
  select 2 * 6371008.8 * asin(sqrt(
    power(sin(radians((lat2 - lat1)::float8) / 2), 2) +
    cos(radians(lat1::float8)) * cos(radians(lat2::float8)) * power(sin(radians((lng2 - lng1)::float8) / 2), 2)))
$$;

-- ---------- mission fields on the existing ticket ----------
alter table public.dispatch_tickets
  add column if not exists proximity_stage text,
  add column if not exists proximity_candidate text,
  add column if not exists proximity_hits smallint not null default 0,
  add column if not exists approaching_at timestamptz,
  add column if not exists nearby_at timestamptz,
  add column if not exists critical_at timestamptz,
  add column if not exists located_at timestamptz,
  add column if not exists located_by uuid references public.users(uid),
  add column if not exists arrived_at timestamptz,
  add column if not exists located_lat numeric(9,6),       -- where the rescuer confirmed arrival
  add column if not exists located_lng numeric(9,6),
  add column if not exists evacuation_started_at timestamptz;

-- Proximity thresholds, editable without code changes (one row):
--   update public.rescue_settings set arrival_radius_m = 8, arrival_accuracy_m = 12;
create table if not exists public.rescue_settings (
  id boolean primary key default true check (id),
  approach_radius_m integer not null default 100 check (approach_radius_m between 20 and 1000),
  approach_accuracy_m integer not null default 50 check (approach_accuracy_m between 5 and 200),
  nearby_radius_m integer not null default 10 check (nearby_radius_m between 3 and 200),
  nearby_accuracy_m integer not null default 15 check (nearby_accuracy_m between 3 and 100),
  arrival_radius_m integer not null default 5 check (arrival_radius_m between 2 and 100),
  arrival_accuracy_m integer not null default 10 check (arrival_accuracy_m between 2 and 100),
  check (arrival_radius_m <= nearby_radius_m and nearby_radius_m <= approach_radius_m)
);
insert into public.rescue_settings (id) values (true) on conflict (id) do nothing;
alter table public.rescue_settings enable row level security;
-- No policies: read only by the rescue functions below; change it in the SQL editor.

alter table public.dispatch_tickets drop constraint if exists dispatch_tickets_proximity_stage_check;
alter table public.dispatch_tickets add constraint dispatch_tickets_proximity_stage_check
  check (proximity_stage is null or proximity_stage in ('approaching', 'nearby', 'critical'));
alter table public.dispatch_tickets drop constraint if exists dispatch_tickets_proximity_candidate_check;
alter table public.dispatch_tickets add constraint dispatch_tickets_proximity_candidate_check
  check (proximity_candidate is null or proximity_candidate in ('approaching', 'nearby', 'critical'));

-- New history actions (existing ones kept).
alter table public.dispatch_ticket_events drop constraint dispatch_ticket_events_action_check;
alter table public.dispatch_ticket_events add constraint dispatch_ticket_events_action_check
  check (action = any (array['created','assigned','reassigned','status','resolved','cancelled',
    'proximity','located','center_assigned','center_released','no_center','arrived','evacuation_started']));

-- Rescuers can now ask the EOC for shelter space when no center can take a household.
alter table public.ticket_backup_requests drop constraint ticket_backup_requests_need_check;
alter table public.ticket_backup_requests add constraint ticket_backup_requests_need_check
  check (need = any (array['boat','ambulance','stretcher','road_clearing','more_people','shelter']));

-- ---------- live location ----------
create table if not exists public.rescue_unit_locations (
  unit_id integer primary key references public.rescue_units(unit_id) on delete cascade,
  ticket_id uuid references public.dispatch_tickets(ticket_id) on delete set null,
  latitude numeric(9,6) not null check (latitude between -90 and 90),
  longitude numeric(9,6) not null check (longitude between -180 and 180),
  accuracy_m real check (accuracy_m is null or accuracy_m between 0 and 5000),
  heading real,
  speed_mps real,
  recorded_at timestamptz not null,               -- when the phone took the fix
  received_at timestamptz not null default clock_timestamp(),
  reported_by uuid not null references public.users(uid),
  target text check (target is null or target in ('resident', 'center')),
  distance_m integer,                              -- to the current target
  proximity_stage text                             -- copy of the ticket's stage, for the resident's live feed
);

create table if not exists public.rescue_location_trail (
  point_id bigint generated always as identity primary key,
  unit_id integer not null references public.rescue_units(unit_id) on delete cascade,
  ticket_id uuid references public.dispatch_tickets(ticket_id) on delete cascade,
  latitude numeric(9,6) not null,
  longitude numeric(9,6) not null,
  accuracy_m real,
  recorded_at timestamptz not null,
  received_at timestamptz not null default clock_timestamp(),
  reported_by uuid not null references public.users(uid)
);
create index if not exists rescue_location_trail_ticket_idx on public.rescue_location_trail (ticket_id, recorded_at);

-- Who may see a unit's live position: the unit itself, the resident it is
-- rescuing (only while that mission is open) and the barangay's staff.
create or replace function public.can_see_unit_location(p_unit integer, p_ticket uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select public.is_unit_member(p_unit) or exists (
    select 1 from public.dispatch_tickets t
    where t.ticket_id = p_ticket and t.assigned_unit_id = p_unit
      and ((t.resident_uid = auth.uid() and t.status in ('assigned','acknowledged','en_route','on_scene'))
           or public.staff_can_access_barangay(t.barangay_id)))
$$;

alter table public.rescue_unit_locations enable row level security;
drop policy if exists rescue_unit_locations_read on public.rescue_unit_locations;
create policy rescue_unit_locations_read on public.rescue_unit_locations
  for select to authenticated using (public.can_see_unit_location(unit_id, ticket_id));
alter table public.rescue_location_trail enable row level security;  -- RPC / service role only

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                 and schemaname = 'public' and tablename = 'rescue_unit_locations') then
    alter publication supabase_realtime add table public.rescue_unit_locations;
  end if;
end $$;

-- ---------- reservations ----------
create table if not exists public.evacuation_reservations (
  reservation_id uuid primary key default gen_random_uuid(),
  center_id integer not null references public.evacuation_centers(center_id),
  ticket_id uuid not null references public.dispatch_tickets(ticket_id) on delete cascade,
  household_id uuid references public.households(household_id) on delete set null,
  resident_uid uuid,
  headcount integer not null check (headcount between 1 and 200),
  status text not null default 'reserved'
    check (status in ('reserved', 'arrived', 'cancelled', 'transferred', 'released')),
  reserved_at timestamptz not null default clock_timestamp(),
  reserved_by uuid references public.users(uid),
  override_note text check (override_note is null or length(override_note) <= 500),
  closed_at timestamptz,
  closed_by uuid references public.users(uid),
  close_note text check (close_note is null or length(close_note) <= 500),
  check ((status = 'reserved') = (closed_at is null))
);
create unique index if not exists evacuation_reservations_one_per_ticket
  on public.evacuation_reservations (ticket_id) where status = 'reserved';
create unique index if not exists evacuation_reservations_one_per_household
  on public.evacuation_reservations (household_id) where status = 'reserved' and household_id is not null;
create index if not exists evacuation_reservations_center_idx
  on public.evacuation_reservations (center_id) where status = 'reserved';
alter table public.evacuation_reservations enable row level security;  -- read through RPCs

drop trigger if exists live_signal on public.evacuation_reservations;
create trigger live_signal after insert or update or delete on public.evacuation_reservations
  for each statement execute function public.bump_live_signal('centers');

create or replace function public.reserved_facility_slots(p_center integer)
returns integer language sql stable security definer set search_path to '' as $$
  select coalesce(sum(headcount), 0)::integer from public.evacuation_reservations
  where center_id = p_center and status = 'reserved'
$$;

-- People a mission brings in: the SOS headcount, else the household size.
create or replace function public.mission_household(p_ticket uuid, out household_id uuid, out headcount integer)
language plpgsql stable security definer set search_path to '' as $$
declare t public.dispatch_tickets; v_sos public.sos_alerts;
begin
  select * into t from public.dispatch_tickets where ticket_id = p_ticket;
  if t.source = 'sos' then
    select * into v_sos from public.sos_alerts where alert_id::text = t.source_ref;
  end if;
  household_id := coalesce(v_sos.household_id,
    (select h.household_id from public.households h where h.head_uid = t.resident_uid limit 1));
  headcount := greatest(1, coalesce(v_sos.headcount,
    case when t.resident_uid is not null then 1 + (select count(*) from public.household_members m
                                                    where m.household_id = mission_household.household_id) end,
    1))::integer;
end;
$$;

-- Locks and returns a ticket the caller may act on as its unit (or as staff).
create or replace function public.lock_mission(p_ticket uuid)
returns public.dispatch_tickets language plpgsql security definer set search_path to '' as $$
declare t public.dispatch_tickets;
begin
  select * into t from public.dispatch_tickets where ticket_id = p_ticket for update;
  if not found then raise exception 'Rescue mission was not found.'; end if;
  if not (public.is_active_rescuer() and public.is_unit_member(t.assigned_unit_id)) then
    perform public.assert_disaster_admin(t.barangay_id);
  end if;
  return t;
end;
$$;

-- Live availability of every active center (for the app, the website and offline caching).
create or replace function public.get_center_availability()
returns jsonb language sql stable security definer set search_path to '' as $$
  select jsonb_build_object('as_of', clock_timestamp(), 'centers', coalesce(jsonb_agg(x order by x->>'center_name'), '[]'::jsonb))
  from (
    select jsonb_build_object('center_id', c.center_id, 'center_name', c.center_name, 'barangay_id', c.barangay_id,
      'latitude', c.gps_lat, 'longitude', c.gps_long, 'status', c.status, 'capacity', c.capacity,
      'occupied', o.occupied, 'reserved', r.reserved,
      'available', greatest(0, c.capacity - o.occupied - r.reserved), 'updated_at', c.updated_at) x
    from public.evacuation_centers c
    cross join lateral (select public.recorded_facility_occupancy(c.center_id) occupied) o
    cross join lateral (select public.reserved_facility_slots(c.center_id) reserved) r
    where c.status = 'active' and auth.uid() is not null
  ) s
$$;

-- ---------- 1. GPS reports from the rescuer's phone ----------
-- p_points: [{lat, lng, accuracy, heading, speed, recorded_at}], oldest first or any order.
-- Offline phones send their queued fixes in one batch when they reconnect.
create or replace function public.report_unit_location(p_ticket_id uuid, p_points jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  t public.dispatch_tickets; p jsonb; v_lat numeric; v_lng numeric; v_acc real; v_at timestamptz;
  v_latest record; v_latest_at timestamptz; v_have_latest boolean := false; v_existing timestamptz;
  v_d double precision; v_q int; v_stage_rank int; v_cand_rank int; v_new_stage text; v_changed text;
  v_target text; v_tlat numeric; v_tlng numeric; v_center public.evacuation_centers; v_accepted int := 0;
  ranks constant text[] := array['approaching','nearby','critical'];
  cfg public.rescue_settings;
begin
  select * into cfg from public.rescue_settings where id;
  if not public.is_active_rescuer() then
    raise exception 'Only active rescuers can share a location.' using errcode = '42501';
  end if;
  select * into t from public.dispatch_tickets where ticket_id = p_ticket_id for update;
  if not found then raise exception 'Rescue mission was not found.'; end if;
  if not public.is_unit_member(t.assigned_unit_id) then
    raise exception 'This mission belongs to another unit.' using errcode = '42501';
  end if;
  if t.status not in ('assigned','acknowledged','en_route','on_scene') then
    return jsonb_build_object('mission_active', false, 'status', t.status);
  end if;
  if jsonb_typeof(p_points) <> 'array' or jsonb_array_length(p_points) = 0 or jsonb_array_length(p_points) > 500 then
    raise exception 'Send between 1 and 500 location points.';
  end if;

  for p in select value from jsonb_array_elements(p_points) order by (value->>'recorded_at') loop
    begin
      v_lat := (p->>'lat')::numeric; v_lng := (p->>'lng')::numeric;
      v_acc := nullif(p->>'accuracy', '')::real;
      v_at := least((p->>'recorded_at')::timestamptz, clock_timestamp());
    exception when others then continue;
    end;
    if v_lat is null or v_lng is null or v_lat not between -90 and 90 or v_lng not between -180 and 180
       or v_at is null or v_at < clock_timestamp() - interval '24 hours'
       or (v_acc is not null and (v_acc < 0 or v_acc > 5000)) then
      continue;
    end if;
    insert into public.rescue_location_trail (unit_id, ticket_id, latitude, longitude, accuracy_m, recorded_at, reported_by)
      values (t.assigned_unit_id, t.ticket_id, v_lat, v_lng, v_acc, v_at, auth.uid());
    v_accepted := v_accepted + 1;

    -- Proximity: only fresh fixes (taken in the last 30 s) and only before the resident is located.
    if t.located_at is null and t.latitude is not null and v_at > clock_timestamp() - interval '30 seconds' then
      v_d := public.geo_distance_m(v_lat, v_lng, t.latitude, t.longitude);
      v_q := case when v_d <= cfg.arrival_radius_m and coalesce(v_acc, 999) <= cfg.arrival_accuracy_m then 3
                  when v_d <= cfg.nearby_radius_m and coalesce(v_acc, 999) <= cfg.nearby_accuracy_m then 2
                  when v_d <= cfg.approach_radius_m and coalesce(v_acc, 999) <= cfg.approach_accuracy_m then 1 else 0 end;
      v_stage_rank := coalesce(array_position(ranks, t.proximity_stage), 0);
      if v_q > v_stage_rank then
        v_cand_rank := coalesce(array_position(ranks, t.proximity_candidate), 0);
        if t.proximity_hits > 0 and v_cand_rank > v_stage_rank then
          t.proximity_candidate := ranks[least(v_cand_rank, v_q)];
          t.proximity_hits := t.proximity_hits + 1;
        else
          t.proximity_candidate := ranks[v_q];
          t.proximity_hits := 1;
        end if;
        -- Two consecutive qualifying fixes are needed before a stage is announced.
        if t.proximity_hits >= 2 then
          v_new_stage := t.proximity_candidate;
          t.proximity_stage := v_new_stage;
          t.approaching_at := coalesce(t.approaching_at, clock_timestamp());
          if v_new_stage in ('nearby','critical') then t.nearby_at := coalesce(t.nearby_at, clock_timestamp()); end if;
          if v_new_stage = 'critical' then t.critical_at := coalesce(t.critical_at, clock_timestamp()); end if;
          t.proximity_hits := 0; t.proximity_candidate := null;
          v_changed := v_new_stage;
          insert into public.dispatch_ticket_events (ticket_id, action, from_status, to_status, unit_id, note, actor_uid)
            values (t.ticket_id, 'proximity', t.status, t.status, t.assigned_unit_id,
                    format('Rescuer %s: about %s m from the resident (GPS accuracy %s m).',
                           v_new_stage, round(v_d), coalesce(round(v_acc)::text, 'unknown')), auth.uid());
        end if;
      else
        t.proximity_hits := 0; t.proximity_candidate := null;
      end if;
    end if;

    if v_latest_at is null or v_at >= v_latest_at then
      v_latest_at := v_at;
      select v_lat as lat, v_lng as lng, v_acc as acc, v_at as at,
             nullif(p->>'heading','')::real as heading, nullif(p->>'speed','')::real as speed into v_latest;
      v_have_latest := true;
    end if;
  end loop;

  update public.dispatch_tickets set proximity_stage = t.proximity_stage, proximity_candidate = t.proximity_candidate,
    proximity_hits = t.proximity_hits, approaching_at = t.approaching_at, nearby_at = t.nearby_at,
    critical_at = t.critical_at
  where ticket_id = t.ticket_id
    and (proximity_stage, proximity_candidate, proximity_hits, approaching_at, nearby_at, critical_at)
        is distinct from (t.proximity_stage, t.proximity_candidate, t.proximity_hits, t.approaching_at, t.nearby_at, t.critical_at);

  if not v_have_latest then
    return jsonb_build_object('mission_active', true, 'accepted', 0);
  end if;

  -- Distance to the current target: the resident, or the reserved center once located.
  if t.located_at is null then
    v_target := 'resident'; v_tlat := t.latitude; v_tlng := t.longitude;
  else
    select c.* into v_center from public.evacuation_reservations r
      join public.evacuation_centers c on c.center_id = r.center_id
      where r.ticket_id = t.ticket_id and r.status = 'reserved';
    if found then v_target := 'center'; v_tlat := v_center.gps_lat; v_tlng := v_center.gps_long; end if;
  end if;
  v_d := case when v_tlat is not null then public.geo_distance_m(v_latest.lat, v_latest.lng, v_tlat, v_tlng) end;

  select recorded_at into v_existing from public.rescue_unit_locations where unit_id = t.assigned_unit_id;
  if v_existing is null or v_latest.at >= v_existing then
    insert into public.rescue_unit_locations as l (unit_id, ticket_id, latitude, longitude, accuracy_m, heading, speed_mps,
        recorded_at, received_at, reported_by, target, distance_m, proximity_stage)
      values (t.assigned_unit_id, t.ticket_id, v_latest.lat, v_latest.lng, v_latest.acc, v_latest.heading, v_latest.speed,
        v_latest.at, clock_timestamp(), auth.uid(), v_target, round(v_d)::integer, t.proximity_stage)
    on conflict (unit_id) do update set ticket_id = excluded.ticket_id, latitude = excluded.latitude,
      longitude = excluded.longitude, accuracy_m = excluded.accuracy_m, heading = excluded.heading,
      speed_mps = excluded.speed_mps, recorded_at = excluded.recorded_at, received_at = excluded.received_at,
      reported_by = excluded.reported_by, target = excluded.target, distance_m = excluded.distance_m,
      proximity_stage = excluded.proximity_stage;
  end if;

  return jsonb_build_object('mission_active', true, 'accepted', v_accepted, 'target', v_target,
    'distance_m', round(v_d), 'proximity_stage', t.proximity_stage, 'stage_changed', v_changed,
    'stale', v_latest.at < clock_timestamp() - interval '30 seconds');
end;
$$;

-- ---------- shared JSON for a mission ----------
create or replace function public.mission_json(p_ticket uuid)
returns jsonb language sql stable security definer set search_path to '' as $$
  select jsonb_build_object(
    'ticket_id', t.ticket_id, 'ticket_no', t.ticket_no, 'status', t.status, 'priority', t.priority,
    'unit_id', t.assigned_unit_id, 'unit_name', u.unit_name,
    'target', jsonb_build_object('latitude', t.latitude, 'longitude', t.longitude),
    'proximity_stage', t.proximity_stage, 'approaching_at', t.approaching_at, 'nearby_at', t.nearby_at,
    'critical_at', t.critical_at, 'located_at', t.located_at, 'arrived_at', t.arrived_at, 'closed_at', t.closed_at,
    'located', case when t.located_lat is not null then jsonb_build_object('latitude', t.located_lat, 'longitude', t.located_lng) end,
    'evacuation_started_at', t.evacuation_started_at,
    'rescue_status', case when t.status = 'resolved' and t.arrived_at is not null then 'EVACUATED'
                          when t.status in ('resolved','cancelled') then upper(t.status)
                          when t.evacuation_started_at is not null then 'EVACUATING'
                          when t.located_at is not null then 'ARRIVED'
                          when t.status = 'assigned' then 'ASSIGNED'
                          else 'ON_THE_WAY' end,
    'headcount', (public.mission_household(t.ticket_id)).headcount,
    'location', (select jsonb_build_object('latitude', l.latitude, 'longitude', l.longitude, 'accuracy_m', l.accuracy_m,
        'heading', l.heading, 'recorded_at', l.recorded_at, 'received_at', l.received_at, 'distance_m', l.distance_m,
        'target', l.target)
      from public.rescue_unit_locations l where l.unit_id = t.assigned_unit_id and l.ticket_id = t.ticket_id),
    'assignment', (select jsonb_build_object('reservation_id', r.reservation_id, 'status', r.status,
        'headcount', r.headcount, 'reserved_at', r.reserved_at, 'override', r.override_note is not null,
        'center_id', c.center_id, 'center_name', c.center_name, 'latitude', c.gps_lat, 'longitude', c.gps_long,
        'center_status', c.status, 'capacity', c.capacity, 'center_type', c.center_type,
        'barangay_name', (select b.barangay_name from public.barangays b where b.barangay_id = c.barangay_id),
        'available', greatest(0, c.capacity - public.recorded_facility_occupancy(c.center_id) - public.reserved_facility_slots(c.center_id)))
      from public.evacuation_reservations r join public.evacuation_centers c on c.center_id = r.center_id
      where r.ticket_id = t.ticket_id and r.status in ('reserved', 'arrived')
      order by r.reserved_at desc limit 1),
    'open_shelter_request', exists (select 1 from public.ticket_backup_requests b
      where b.ticket_id = t.ticket_id and b.need = 'shelter' and b.status = 'open'))
  from public.dispatch_tickets t left join public.rescue_units u on u.unit_id = t.assigned_unit_id
  where t.ticket_id = p_ticket
$$;

-- Resident: the rescue coming to me (open mission, or one closed in the last 12 h).
create or replace function public.get_my_rescue_tracking()
returns jsonb language sql stable security definer set search_path to '' as $$
  select public.mission_json(t.ticket_id) from public.dispatch_tickets t
  where t.resident_uid = auth.uid() and t.assigned_unit_id is not null
    and (t.status in ('assigned','acknowledged','en_route','on_scene') or t.closed_at > now() - interval '12 hours')
  order by (t.status in ('assigned','acknowledged','en_route','on_scene')) desc, t.created_at desc
  limit 1
$$;

-- Rescuer / staff: one mission.
create or replace function public.get_mission_status(p_ticket_id uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_unit integer; v_barangay integer;
begin
  select assigned_unit_id, barangay_id into v_unit, v_barangay from public.dispatch_tickets where ticket_id = p_ticket_id;
  if not found then raise exception 'Rescue mission was not found.'; end if;
  if not (public.is_unit_member(v_unit) or public.staff_can_access_barangay(v_barangay)) then
    raise exception 'You cannot view this mission.' using errcode = '42501';
  end if;
  return public.mission_json(p_ticket_id);
end;
$$;

-- ---------- 2. center selection + atomic reservation ----------
-- Picks the NEAREST center that is active and has room for the whole household,
-- reserves the seats and returns it. Full or too-small centers are never chosen.
-- p_center_id: ask for a specific center (must also be eligible), or, for an
--   administrator with p_override_note, approve an alternative arrangement.
create or replace function public.assign_evacuation_center(
  p_ticket_id uuid, p_lat numeric default null, p_lng numeric default null,
  p_center_id integer default null, p_exclude integer[] default '{}', p_max_km numeric default 30,
  p_override_note text default null, p_road_order integer[] default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  t public.dispatch_tickets; v_household uuid; v_head integer; v_lat numeric; v_lng numeric;
  v_current public.evacuation_reservations; v_choice record; v_res uuid; v_is_admin boolean;
  v_candidates jsonb; v_note text := nullif(btrim(coalesce(p_override_note, '')), '');
begin
  t := public.lock_mission(p_ticket_id);
  v_is_admin := not (public.is_active_rescuer() and public.is_unit_member(t.assigned_unit_id));
  if t.status not in ('assigned','acknowledged','en_route','on_scene') then
    raise exception 'This mission is not active (status %).', t.status;
  end if;
  if t.located_at is null and not v_is_admin then
    raise exception 'Confirm that you have located the resident first.';
  end if;
  if v_note is not null and not v_is_admin then
    raise exception 'Only an administrator can approve an alternative arrangement.' using errcode = '42501';
  end if;
  select household_id, headcount into v_household, v_head from public.mission_household(t.ticket_id);

  -- Where the trip starts: the given point, else where the resident was found, else the unit's last fresh fix, else the SOS point.
  v_lat := p_lat; v_lng := p_lng;
  if v_lat is null or v_lng is null then v_lat := t.located_lat; v_lng := t.located_lng; end if;  -- where the resident was found
  if v_lat is null or v_lng is null then
    select l.latitude, l.longitude into v_lat, v_lng from public.rescue_unit_locations l
      where l.unit_id = t.assigned_unit_id and l.recorded_at > clock_timestamp() - interval '2 minutes';
  end if;
  if v_lat is null or v_lng is null then v_lat := t.latitude; v_lng := t.longitude; end if;
  if v_lat is null then raise exception 'No location is known for this mission.'; end if;

  -- Lock every active center (same order everywhere: no deadlocks), then this mission's reservation.
  perform 1 from public.evacuation_centers where status = 'active' order by center_id for update;
  select * into v_current from public.evacuation_reservations
    where ticket_id = t.ticket_id and status = 'reserved' for update;

  with c as (
    select c.center_id, c.center_name, c.gps_lat, c.gps_long, c.capacity,
      public.geo_distance_m(v_lat, v_lng, c.gps_lat, c.gps_long) as dist,
      public.recorded_facility_occupancy(c.center_id) as occupied,
      public.reserved_facility_slots(c.center_id)
        - case when c.center_id = v_current.center_id then v_current.headcount else 0 end as reserved
    from public.evacuation_centers c
    where c.status = 'active' and c.gps_lat is not null and c.gps_long is not null
      and not (c.center_id = any (coalesce(p_exclude, '{}')))
  ), scored as (
    select *, greatest(0, capacity - occupied - reserved) as available from c where dist <= p_max_km * 1000
  )
  select coalesce(jsonb_agg(jsonb_build_object('center_id', center_id, 'center_name', center_name,
      'distance_m', round(dist), 'capacity', capacity, 'occupied', occupied, 'reserved', reserved,
      'available', available, 'eligible', available >= v_head) order by dist), '[]'::jsonb)
    into v_candidates from scored;

  select * into v_choice from (
    select (x->>'center_id')::int center_id, x->>'center_name' center_name, (x->>'distance_m')::int distance_m,
      (x->>'available')::int available, (x->>'capacity')::int capacity, (x->>'eligible')::boolean eligible
    from jsonb_array_elements(v_candidates) x) s
  where (p_center_id is null and s.eligible)
     or (p_center_id is not null and s.center_id = p_center_id and (s.eligible or v_note is not null))
  -- p_road_order: center ids sorted by ROAD distance (the app asks the router). The first one
  -- that still has room wins; straight-line distance only breaks ties / unlisted centers.
  order by array_position(p_road_order, s.center_id) nulls last, s.distance_m limit 1;

  if v_choice.center_id is null then
    -- Never assign a full center. Tell the EOC (one open shelter request per mission).
    insert into public.dispatch_ticket_events (ticket_id, action, from_status, to_status, unit_id, note, actor_uid)
      values (t.ticket_id, 'no_center', t.status, t.status, t.assigned_unit_id,
        format('No active center within %s km can take %s people.', p_max_km, v_head), auth.uid());
    if not exists (select 1 from public.ticket_backup_requests where ticket_id = t.ticket_id and need = 'shelter' and status = 'open') then
      insert into public.ticket_backup_requests (ticket_id, need, note, requested_by)
        values (t.ticket_id, 'shelter', format('No evacuation center has room for %s people. Assign a center or approve an alternative.', v_head), auth.uid());
    end if;
    return jsonb_build_object('assigned', false, 'headcount', v_head,
      'reason', case when p_center_id is not null then 'That center cannot take this household.'
                     else 'No evacuation center nearby has room for the whole household.' end,
      'candidates', v_candidates, 'kept_reservation', v_current.reservation_id is not null);
  end if;

  if v_current.reservation_id is not null and v_current.center_id = v_choice.center_id then
    v_res := v_current.reservation_id;   -- same center: keep the seats already held
  else
    if v_current.reservation_id is not null then
      update public.evacuation_reservations set status = 'transferred', closed_at = clock_timestamp(),
        closed_by = auth.uid(), close_note = format('Moved to %s', v_choice.center_name)
        where reservation_id = v_current.reservation_id;
    end if;
    insert into public.evacuation_reservations (center_id, ticket_id, household_id, resident_uid, headcount,
        reserved_by, override_note)
      values (v_choice.center_id, t.ticket_id, v_household, t.resident_uid, v_head, auth.uid(), v_note)
      returning reservation_id into v_res;
    update public.ticket_backup_requests set status = 'handled', handled_by = auth.uid(), handled_at = clock_timestamp()
      where ticket_id = t.ticket_id and need = 'shelter' and status = 'open';
    insert into public.dispatch_ticket_events (ticket_id, action, from_status, to_status, unit_id, note, actor_uid)
      values (t.ticket_id, 'center_assigned', t.status, t.status, t.assigned_unit_id,
        format('%s reserved for %s people (%s m away%s).', v_choice.center_name, v_head, v_choice.distance_m,
               case when v_note is not null then '; approved alternative: ' || v_note else '' end), auth.uid());
  end if;

  return jsonb_build_object('assigned', true, 'reservation_id', v_res, 'headcount', v_head,
    'override', v_note is not null,
    'center', (select jsonb_build_object('center_id', c.center_id, 'center_name', c.center_name,
        'latitude', c.gps_lat, 'longitude', c.gps_long, 'capacity', c.capacity, 'distance_m', v_choice.distance_m,
        'available', greatest(0, c.capacity - public.recorded_facility_occupancy(c.center_id) - public.reserved_facility_slots(c.center_id)),
        'status', 'ACCEPTING EVACUEES')
      from public.evacuation_centers c where c.center_id = v_choice.center_id),
    'candidates', v_candidates);
end;
$$;

-- ---------- 3. rescuer confirms the resident is found ----------
create or replace function public.confirm_resident_located(p_ticket_id uuid, p_lat numeric default null,
  p_lng numeric default null, p_accuracy real default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare t public.dispatch_tickets; v_d double precision;
begin
  t := public.lock_mission(p_ticket_id);
  if t.status not in ('assigned','acknowledged','en_route','on_scene') then
    raise exception 'This mission is not active (status %).', t.status;
  end if;
  if t.located_at is null then
    if p_lat is not null and t.latitude is not null then
      v_d := public.geo_distance_m(p_lat, p_lng, t.latitude, t.longitude);
    end if;
    update public.dispatch_tickets set located_at = clock_timestamp(), located_by = auth.uid(),
      located_lat = coalesce(p_lat, t.latitude), located_lng = coalesce(p_lng, t.longitude),
      status = 'on_scene' where ticket_id = t.ticket_id;
    if t.status <> 'on_scene' then
      insert into public.dispatch_ticket_events (ticket_id, action, from_status, to_status, unit_id, note, actor_uid)
        values (t.ticket_id, 'status', t.status, 'on_scene', t.assigned_unit_id, 'Resident located', auth.uid());
    end if;
    insert into public.dispatch_ticket_events (ticket_id, action, from_status, to_status, unit_id, note, actor_uid)
      values (t.ticket_id, 'located', 'on_scene', 'on_scene', t.assigned_unit_id,
        'Rescuer confirmed the resident was found' ||
        case when v_d is not null then format(' (%s m from the SOS point, GPS accuracy %s m).',
          round(v_d), coalesce(round(p_accuracy)::text, 'unknown')) else '.' end, auth.uid());
  end if;
  -- Arrival only (the resident is told). Choosing a center is the next, separate step.
  return public.mission_json(p_ticket_id);
end;
$$;

-- ---------- 3b. rescuer starts taking the household to the reserved center ----------
create or replace function public.start_evacuation(p_ticket_id uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare t public.dispatch_tickets; v_res public.evacuation_reservations; v_name text;
begin
  t := public.lock_mission(p_ticket_id);
  if t.status not in ('assigned','acknowledged','en_route','on_scene') then
    raise exception 'This mission is not active (status %).', t.status;
  end if;
  if t.located_at is null then raise exception 'Confirm arrival at the resident first.'; end if;
  select * into v_res from public.evacuation_reservations where ticket_id = t.ticket_id and status = 'reserved';
  if not found then raise exception 'Reserve an evacuation center first.'; end if;
  if t.evacuation_started_at is null then   -- once per mission: no repeated resident notices
    select center_name into v_name from public.evacuation_centers where center_id = v_res.center_id;
    update public.dispatch_tickets set evacuation_started_at = clock_timestamp() where ticket_id = t.ticket_id;
    insert into public.dispatch_ticket_events (ticket_id, action, from_status, to_status, unit_id, note, actor_uid)
      values (t.ticket_id, 'evacuation_started', t.status, t.status, t.assigned_unit_id,
        format('Taking %s people to %s.', v_res.headcount, v_name), auth.uid());
  end if;
  return public.mission_json(p_ticket_id);
end;
$$;

-- ---------- 4. cancel an assignment (seats go back) ----------
create or replace function public.release_evacuation_reservation(p_ticket_id uuid, p_reason text)
returns void language plpgsql security definer set search_path to '' as $$
declare t public.dispatch_tickets; v_res public.evacuation_reservations;
begin
  t := public.lock_mission(p_ticket_id);
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Say why the assignment is cancelled.'; end if;
  select * into v_res from public.evacuation_reservations where ticket_id = t.ticket_id and status = 'reserved' for update;
  if not found then raise exception 'This mission has no center reserved.'; end if;
  update public.evacuation_reservations set status = 'cancelled', closed_at = clock_timestamp(), closed_by = auth.uid(),
    close_note = left(btrim(p_reason), 500) where reservation_id = v_res.reservation_id;
  insert into public.dispatch_ticket_events (ticket_id, action, from_status, to_status, unit_id, note, actor_uid)
    values (t.ticket_id, 'center_released', t.status, t.status, t.assigned_unit_id, left(btrim(p_reason), 1000), auth.uid());
end;
$$;

-- ---------- 5. arrival: seats become occupancy, mission closes ----------
create or replace function public.confirm_evacuation_arrival(p_ticket_id uuid, p_note text default '')
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  t public.dispatch_tickets; v_res public.evacuation_reservations; v_center public.evacuation_centers;
  v_household uuid; v_people integer := 0; v_extra integer; v_name text; m record;
begin
  t := public.lock_mission(p_ticket_id);
  if t.status not in ('assigned','acknowledged','en_route','on_scene') then
    raise exception 'This mission is not active (status %).', t.status;
  end if;
  select * into v_res from public.evacuation_reservations where ticket_id = t.ticket_id and status = 'reserved' for update;
  if not found then raise exception 'No evacuation center is reserved for this mission.'; end if;
  select * into v_center from public.evacuation_centers where center_id = v_res.center_id for update;
  if v_center.status <> 'active' then
    raise exception '% is closed. Assign another center.', v_center.center_name;
  end if;
  v_household := v_res.household_id;

  -- One record per person; people already sheltered here are not counted twice.
  if t.resident_uid is not null then
    if coalesce((select er.evac_center_id = v_center.center_id and er.evac_status::text = 'safely_evacuated'
                 from public.evacuation_records er where er.resident_uid = t.resident_uid
                 order by er.logged_at desc nulls last limit 1), false) is false then
      insert into public.evacuation_records (resident_uid, barangay_id, rescuer_uid, evac_center_id, evac_status, evacuated_at, logged_at)
        values (t.resident_uid, t.barangay_id, case when public.is_active_rescuer() then auth.uid() end,
                v_center.center_id, 'safely_evacuated', clock_timestamp(), clock_timestamp());
    end if;
    v_people := 1;
  end if;
  if v_household is not null then
    for m in select hm.member_id from public.household_members hm where hm.household_id = v_household loop
      exit when v_people >= v_res.headcount;
      if coalesce((select er.evac_center_id = v_center.center_id and er.evac_status::text = 'safely_evacuated'
                   from public.evacuation_records er where er.member_id = m.member_id
                   order by er.logged_at desc nulls last limit 1), false) is false then
        insert into public.evacuation_records (member_id, barangay_id, rescuer_uid, evac_center_id, evac_status, evacuated_at, logged_at)
          values (m.member_id, t.barangay_id, case when public.is_active_rescuer() then auth.uid() end,
                  v_center.center_id, 'safely_evacuated', clock_timestamp(), clock_timestamp());
      end if;
      v_people := v_people + 1;
    end loop;
  end if;
  -- Anyone else brought in (SOS headcount larger than the registered household).
  v_extra := v_res.headcount - v_people;
  if v_extra > 0 then
    v_name := coalesce((select nullif(btrim(concat_ws(' ', u.f_name, u.l_name)), '') from public.users u where u.uid = t.resident_uid), t.subject);
    insert into public.evacuation_records (walkin_name, barangay_id, rescuer_uid, evac_center_id, evac_status, evacuated_at, logged_at, headcount, needs)
      values (left('Group of ' || v_name, 200), t.barangay_id, case when public.is_active_rescuer() then auth.uid() end,
              v_center.center_id, 'safely_evacuated', clock_timestamp(), clock_timestamp(), least(v_extra, 50),
              format('Rescue mission #%s', t.ticket_no));
  end if;

  update public.evacuation_reservations set status = 'arrived', closed_at = clock_timestamp(), closed_by = auth.uid(),
    close_note = 'Arrived' where reservation_id = v_res.reservation_id;
  insert into public.dispatch_ticket_events (ticket_id, action, from_status, to_status, unit_id, note, actor_uid)
    values (t.ticket_id, 'arrived', t.status, t.status, t.assigned_unit_id,
      format('%s people arrived at %s.', v_res.headcount, v_center.center_name), auth.uid());
  update public.dispatch_tickets set arrived_at = clock_timestamp(), status = 'resolved', closed_at = clock_timestamp(),
    closed_by = auth.uid(),
    outcome_note = left(format('Evacuated %s people to %s.%s', v_res.headcount, v_center.center_name,
                         coalesce(' ' || nullif(btrim(p_note), ''), '')), 1000)
    where ticket_id = t.ticket_id;
  insert into public.dispatch_ticket_events (ticket_id, action, from_status, to_status, unit_id, note, actor_uid)
    values (t.ticket_id, 'resolved', t.status, 'resolved', t.assigned_unit_id,
      format('Arrived at %s', v_center.center_name), auth.uid());
  return jsonb_build_object('center_name', v_center.center_name, 'headcount', v_res.headcount);
end;
$$;

-- A mission closed any other way gives its seats back.
create or replace function public.release_reservation_on_close()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if new.status in ('resolved','cancelled') and old.status not in ('resolved','cancelled') then
    update public.evacuation_reservations set status = 'released', closed_at = clock_timestamp(),
      closed_by = auth.uid(), close_note = 'Mission ' || new.status
      where ticket_id = new.ticket_id and status = 'reserved';
  end if;
  return null;
end;
$$;
drop trigger if exists release_reservation_on_close on public.dispatch_tickets;
create trigger release_reservation_on_close after update of status on public.dispatch_tickets
  for each row execute function public.release_reservation_on_close();

-- ---------- grants ----------
revoke all on function public.geo_distance_m(numeric, numeric, numeric, numeric) from public, anon;
revoke all on function public.can_see_unit_location(integer, uuid) from public, anon;
revoke all on function public.reserved_facility_slots(integer) from public, anon;
revoke all on function public.mission_household(uuid) from public, anon, authenticated;
revoke all on function public.lock_mission(uuid) from public, anon, authenticated;
revoke all on function public.mission_json(uuid) from public, anon, authenticated;
revoke all on function public.release_reservation_on_close() from public, anon, authenticated;
revoke all on function public.get_center_availability() from public, anon;
revoke all on function public.report_unit_location(uuid, jsonb) from public, anon;
revoke all on function public.get_my_rescue_tracking() from public, anon;
revoke all on function public.get_mission_status(uuid) from public, anon;
revoke all on function public.assign_evacuation_center(uuid, numeric, numeric, integer, integer[], numeric, text, integer[]) from public, anon;
revoke all on function public.start_evacuation(uuid) from public, anon;
revoke all on function public.confirm_resident_located(uuid, numeric, numeric, real) from public, anon;
revoke all on function public.release_evacuation_reservation(uuid, text) from public, anon;
revoke all on function public.confirm_evacuation_arrival(uuid, text) from public, anon;
grant execute on function public.geo_distance_m(numeric, numeric, numeric, numeric), public.can_see_unit_location(integer, uuid),
  public.reserved_facility_slots(integer), public.get_center_availability(), public.report_unit_location(uuid, jsonb),
  public.get_my_rescue_tracking(), public.get_mission_status(uuid),
  public.assign_evacuation_center(uuid, numeric, numeric, integer, integer[], numeric, text, integer[]),
  public.start_evacuation(uuid),
  public.confirm_resident_located(uuid, numeric, numeric, real), public.release_evacuation_reservation(uuid, text),
  public.confirm_evacuation_arrival(uuid, text) to authenticated;
grant select on public.rescue_unit_locations to authenticated;
