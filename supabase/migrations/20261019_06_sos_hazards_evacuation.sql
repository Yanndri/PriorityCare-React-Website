-- PriorityCare step 3: SOS from the app, hazard reports, member-level evacuation
-- =================================================================
-- Run after 20261019_05. One transaction.
--
-- 1. sos_alerts becomes a real table for the app's SOS button: linked to the
--    resident (uuid), household and barangay, with GPS, emergency type,
--    headcount, and a cancel reason. Residents raise and cancel through
--    raise_sos / cancel_my_sos and follow progress with get_my_sos. A
--    resolved SOS dispatch ticket resolves the alert.
-- 2. hazard_reports: hazards pinned from the app (fire, flood, blocked road,
--    live wire...). Rescuers and admins confirm, flag for review, dismiss or
--    resolve them. Residents see confirmed hazards and their own reports.
-- 3. Evacuation records can now be for a household member (no login) or a
--    walk-in group, not only a registered resident. Shelter occupancy counts
--    all of them. Residents can flag a household member missing or safe.
-- 4. get_rescuer_feed: everything the rescuer app shows in one call.
-- 5. Evacuation centers get an amenities list; ID types match the app.

begin;

-- ---------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------
create or replace function public.resident_household_id(p_uid uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select d.household_id from public.resident_profile_details d where d.resident_uid = p_uid),
    (select h.household_id from public.households h where h.head_uid = p_uid))
$$;
revoke all on function public.resident_household_id(uuid) from public, anon, authenticated;

-- 3 = someone cannot move without help (bedridden, wheelchair, infant, pregnant),
-- 2 = someone needs assistance (assisted, child, senior), 1 = everyone walks unaided.
create or replace function public.household_alert_level(p_uid uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select case
    when r.mobility_status::text = 'non_ambulatory' or coalesce(d.is_pregnant, false)
      or exists (select 1 from public.household_members m
                 where m.household_id = public.resident_household_id(r.uid)
                   and (m.mobility in ('wheelchair', 'bedridden') or m.age_group = 'infant' or m.is_pregnant))
      then 3
    when r.mobility_status::text = 'semi_ambulatory' or r.birthdate <= current_date - interval '60 years'
      or exists (select 1 from public.household_members m
                 where m.household_id = public.resident_household_id(r.uid)
                   and (m.mobility = 'assisted' or m.age_group in ('child', 'senior')))
      then 2
    else 1 end
  from public.residents r
  left join public.resident_profile_details d on d.resident_uid = r.uid
  where r.uid = p_uid
$$;
revoke all on function public.household_alert_level(uuid) from public, anon, authenticated;

create or replace function public.is_active_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.users u where u.uid = auth.uid() and u.account_status = 'active'
                 and u.role::text in ('admin', 'super_admin'))
$$;
revoke all on function public.is_active_staff() from public, anon;
grant execute on function public.is_active_staff() to authenticated;

create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.users u where u.uid = auth.uid() and u.account_status = 'active')
$$;
revoke all on function public.is_active_user() from public, anon;
grant execute on function public.is_active_user() to authenticated;

-- Evacuation centres list their amenities (shown in the app).
alter table public.evacuation_centers
  add column if not exists amenities text[] not null default '{}' check (cardinality(amenities) <= 20);

-- Evacuation records can be for a household member or a walk-in group (see section 3).
alter table public.evacuation_records
  alter column resident_uid drop not null,
  add column if not exists member_id uuid references public.household_members(member_id) on delete cascade,
  add column if not exists barangay_id integer references public.barangays(barangay_id),
  add column if not exists walkin_name text check (walkin_name is null or length(btrim(walkin_name)) between 1 and 200),
  add column if not exists walkin_sitio text not null default '' check (length(walkin_sitio) <= 100),
  add column if not exists headcount integer not null default 1 check (headcount between 1 and 50),
  add column if not exists needs text not null default '' check (length(needs) <= 500),
  add constraint evacuation_records_one_person check (
    (resident_uid is not null)::int + (member_id is not null)::int + (walkin_name is not null)::int = 1),
  add constraint evacuation_records_group_walkin check (walkin_name is not null or headcount = 1);
update public.evacuation_records er set barangay_id = r.barangay_id
  from public.residents r where r.uid = er.resident_uid and er.barangay_id is null;
create index if not exists evacuation_records_member on public.evacuation_records(member_id, logged_at desc);
create index if not exists evacuation_records_center on public.evacuation_records(evac_center_id);

-- ---------------------------------------------------------------
-- 1. SOS alerts
-- ---------------------------------------------------------------
drop policy if exists sos_alerts_select_staff on public.sos_alerts;
alter table public.sos_alerts alter column resident_uid type uuid using resident_uid::uuid;
update public.sos_alerts set status = 'active' where status is null;
update public.sos_alerts set alert_type = upper(alert_type);
update public.sos_alerts set alert_type = 'OTHER'
  where alert_type not in ('FLOOD', 'FIRE', 'MEDICAL', 'TRAPPED', 'OTHER');
alter table public.sos_alerts
  alter column alert_id set default gen_random_uuid(),
  alter column status type text, alter column status set default 'active', alter column status set not null,
  alter column alert_type type text,
  alter column created_at set not null,
  add column if not exists household_id uuid references public.households(household_id) on delete set null,
  add column if not exists barangay_id integer references public.barangays(barangay_id),
  add column if not exists latitude numeric,
  add column if not exists longitude numeric,
  add column if not exists headcount integer not null default 1 check (headcount between 1 and 100),
  add column if not exists note text not null default '' check (length(note) <= 500),
  add column if not exists cancel_reason text check (cancel_reason in ('self_evacuated', 'threat_receded', 'accidental')),
  add column if not exists closed_at timestamptz,
  add column if not exists updated_at timestamptz not null default now(),
  add constraint sos_alerts_resident_fkey foreign key (resident_uid) references public.residents(uid) on delete cascade,
  add constraint sos_alerts_status_check check (status in ('active', 'resolved', 'cancelled')),
  add constraint sos_alerts_type_check check (alert_type in ('FLOOD', 'FIRE', 'MEDICAL', 'TRAPPED', 'OTHER')),
  add constraint sos_alerts_level_check check (alert_level between 1 and 3),
  add constraint sos_alerts_coords_check check ((latitude is null) = (longitude is null)
    and (latitude is null or (latitude between -90 and 90 and longitude between -180 and 180))),
  add constraint sos_alerts_closed_check check ((status = 'active') = (closed_at is null));
update public.sos_alerts a set barangay_id = r.barangay_id from public.residents r where r.uid = a.resident_uid;
create unique index if not exists sos_alerts_one_active on public.sos_alerts(resident_uid) where status = 'active';
create index if not exists sos_alerts_status_created on public.sos_alerts(status, created_at desc);

alter table public.sos_alerts enable row level security;
revoke all on public.sos_alerts from anon, authenticated;
grant select on public.sos_alerts to authenticated;
create policy sos_alerts_read on public.sos_alerts for select to authenticated
  using (resident_uid = auth.uid() or public.is_active_rescuer() or public.staff_can_access_resident(resident_uid));

-- Existing functions compared the old text column.
do $$
declare
  def text;
  fixes text[][] := array[
    array['get_dispatch_board', 'join public.residents r on r.uid::text = a.resident_uid',
                                'join public.residents r on r.uid = a.resident_uid'],
    array['get_operational_timeline', 'join public.residents r on r.uid::text = s.resident_uid',
                                      'join public.residents r on r.uid = s.resident_uid'],
    array['change_evacuation_facility_status', 'distinct on (resident_uid) resident_uid,evac_center_id,evac_status',
          'distinct on (coalesce(resident_uid, member_id, record_id)) resident_uid,evac_center_id,evac_status'],
    array['change_evacuation_facility_status', 'from public.evacuation_records order by resident_uid,logged_at',
          'from public.evacuation_records order by coalesce(resident_uid, member_id, record_id),logged_at']
  ];
  i int;
  hits int;
begin
  for i in 1 .. array_length(fixes, 1) loop
    select pg_get_functiondef(p.oid) into def from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.proname = fixes[i][1];
    hits := (length(def) - length(replace(def, fixes[i][2], ''))) / length(fixes[i][2]);
    if hits <> 1 then
      raise exception 'Step 3: expected 1 match in %, found % (fix %)', fixes[i][1], hits, i;
    end if;
    execute replace(def, fixes[i][2], fixes[i][3]);
  end loop;
end $$;

-- The latest SOS of the signed-in resident (active, or closed in the last day),
-- with the dispatch progress the app shows:
-- TRANSMITTED (waiting for a team), DISPATCHED (team assigned and moving),
-- EVACUATED (household logged at a shelter), RESOLVED, CANCELLED.
create or replace function public.get_my_sos()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'alert_id', a.alert_id, 'alert_type', a.alert_type, 'alert_level', a.alert_level, 'status', a.status,
    'headcount', a.headcount, 'note', a.note, 'cancel_reason', a.cancel_reason,
    'latitude', a.latitude, 'longitude', a.longitude, 'created_at', a.created_at, 'closed_at', a.closed_at,
    'ticket', case when t.ticket_id is null then null else jsonb_build_object(
      'ticket_no', t.ticket_no, 'status', t.status, 'unit_name', un.unit_name, 'priority', t.priority,
      'assigned_at', t.assigned_at, 'closed_at', t.closed_at) end,
    'shelter', ev.center_name,
    'app_status', case
      when a.status = 'cancelled' then 'CANCELLED'
      when ev.center_name is not null then 'EVACUATED'
      when a.status = 'resolved' then 'RESOLVED'
      when t.status in ('assigned', 'acknowledged', 'en_route', 'on_scene') then 'DISPATCHED'
      else 'TRANSMITTED' end)
  from public.sos_alerts a
  left join lateral (
    select * from public.dispatch_tickets x where x.source = 'sos' and x.source_ref = a.alert_id::text
    order by x.created_at desc limit 1) t on true
  left join public.rescue_units un on un.unit_id = t.assigned_unit_id
  left join lateral (
    select c.center_name from public.evacuation_records er
    join public.evacuation_centers c on c.center_id = er.evac_center_id
    where er.evac_status::text = 'safely_evacuated' and er.logged_at >= a.created_at
      and (er.resident_uid = a.resident_uid
           or er.member_id in (select m.member_id from public.household_members m where m.household_id = a.household_id))
    order by er.logged_at desc limit 1) ev on true
  where a.resident_uid = auth.uid() and (a.status = 'active' or a.closed_at > now() - interval '1 day')
  order by a.created_at desc
  limit 1
$$;

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
    insert into public.sos_alerts (resident_uid, household_id, barangay_id, alert_type, alert_level,
                                   latitude, longitude, headcount, note, status)
    values (auth.uid(), v_household, r.barangay_id, upper(p_type), public.household_alert_level(auth.uid()),
            coalesce(p_lat, r.gps_lat), coalesce(p_lng, r.gps_long),
            1 + (select count(*) from public.household_members m where m.household_id = v_household),
            left(btrim(coalesce(p_note, '')), 500), 'active');
  end if;
  return public.get_my_sos();
end;
$$;

-- Cancelling closes the alert. A ticket nobody has acknowledged yet is
-- cancelled with it; a team already moving keeps its ticket and sees the
-- cancellation (and reason) in their feed.
create or replace function public.cancel_my_sos(p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.sos_alerts; t public.dispatch_tickets; label text;
begin
  label := case p_reason when 'self_evacuated' then 'Household self-evacuated'
                         when 'threat_receded' then 'Threat receded, safe at home'
                         when 'accidental' then 'Accidental SOS' end;
  if label is null then raise exception 'Choose why you are cancelling.'; end if;
  update public.sos_alerts set status = 'cancelled', cancel_reason = p_reason,
    closed_at = clock_timestamp(), updated_at = clock_timestamp()
  where resident_uid = auth.uid() and status = 'active'
  returning * into a;
  if not found then raise exception 'You have no active SOS.'; end if;
  for t in select * from public.dispatch_tickets x where x.source = 'sos' and x.source_ref = a.alert_id::text
             and x.status in ('open', 'assigned') for update loop
    update public.dispatch_tickets set status = 'cancelled', closed_at = clock_timestamp(), closed_by = auth.uid(),
      outcome_note = 'Resident cancelled the SOS: ' || label
    where ticket_id = t.ticket_id;
    insert into public.dispatch_ticket_events (ticket_id, action, from_status, to_status, unit_id, note, actor_uid)
    values (t.ticket_id, 'cancelled', t.status, 'cancelled', t.assigned_unit_id,
            'Resident cancelled the SOS: ' || label, auth.uid());
  end loop;
  return public.get_my_sos();
end;
$$;

-- A resolved SOS ticket resolves its alert.
create or replace function public.resolve_sos_from_ticket()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.source = 'sos' and new.status = 'resolved' and old.status is distinct from 'resolved' then
    update public.sos_alerts set status = 'resolved', closed_at = clock_timestamp(), updated_at = clock_timestamp()
    where alert_id::text = new.source_ref and status = 'active';
  end if;
  return null;
end;
$$;
create trigger resolve_sos_from_ticket after update of status on public.dispatch_tickets
  for each row execute function public.resolve_sos_from_ticket();

-- ---------------------------------------------------------------
-- 2. Hazard reports
-- ---------------------------------------------------------------
create table public.hazard_reports (
  hazard_id uuid primary key default gen_random_uuid(),
  barangay_id integer not null references public.barangays(barangay_id),
  event_id uuid references public.disaster_events(event_id) on delete set null,
  hazard_type text not null check (hazard_type in ('FIRE', 'FLOOD', 'BLOCK', 'WIRE', 'LANDSLIDE', 'OTHER')),
  description text not null default '' check (length(description) <= 1000),
  latitude numeric not null check (latitude between -90 and 90),
  longitude numeric not null check (longitude between -180 and 180),
  photo_path text check (photo_path is null or length(photo_path) <= 300),
  status text not null default 'unverified'
    check (status in ('unverified', 'under_review', 'confirmed', 'dismissed', 'resolved')),
  reported_by uuid not null references auth.users(id),
  reporter_role text not null,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_note text check (review_note is null or length(review_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index hazard_reports_status_created on public.hazard_reports(status, created_at desc);
create index hazard_reports_barangay on public.hazard_reports(barangay_id, status);
alter table public.hazard_reports enable row level security;
revoke all on public.hazard_reports from anon, authenticated;
grant select on public.hazard_reports to authenticated;
create policy hazard_reports_read on public.hazard_reports for select to authenticated using (
  public.is_active_rescuer() or public.staff_can_access_barangay(barangay_id) or reported_by = auth.uid()
  or (status = 'confirmed' and public.is_active_user()));

-- Barangay whose centre is nearest a point (the app normally sends the barangay it found on its map).
create or replace function public.nearest_barangay(p_lat numeric, p_lng numeric)
returns integer language sql stable set search_path = '' as $$
  select barangay_id from public.barangays where center_lat is not null
  order by (center_lat - p_lat)^2 + ((center_lng - p_lng) * cos(radians(p_lat::float8)))^2 limit 1
$$;

create or replace function public.report_hazard(p_type text, p_description text, p_lat numeric, p_lng numeric,
                                                p_barangay_id integer, p_photo_path text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_role text; v_barangay integer; v_id uuid; v_status text := 'unverified';
begin
  select role::text into v_role from public.users where uid = auth.uid() and account_status = 'active';
  if v_role is null then raise exception 'Sign in to report a hazard.'; end if;
  if upper(coalesce(p_type, '')) not in ('FIRE', 'FLOOD', 'BLOCK', 'WIRE', 'LANDSLIDE', 'OTHER') then
    raise exception 'Choose the type of hazard.';
  end if;
  if p_lat is null or p_lng is null then raise exception 'Pin the hazard on the map.'; end if;
  if p_photo_path is not null and p_photo_path not like auth.uid()::text || '/%' then
    raise exception 'Upload the photo into your own folder first.';
  end if;
  v_barangay := coalesce(p_barangay_id, public.nearest_barangay(p_lat, p_lng));
  if not exists (select 1 from public.barangays where barangay_id = v_barangay) then
    raise exception 'Unknown barangay.';
  end if;
  if v_role = 'resident' and (select count(*) from public.hazard_reports
      where reported_by = auth.uid() and created_at > now() - interval '10 minutes') >= 3 then
    raise exception 'You have sent several reports just now. Please wait a few minutes.';
  end if;
  -- Field teams and barangay staff are trusted reporters.
  if v_role = 'rescuer' or public.staff_can_access_barangay(v_barangay) then v_status := 'confirmed'; end if;
  insert into public.hazard_reports (barangay_id, event_id, hazard_type, description, latitude, longitude, photo_path,
                                     status, reported_by, reporter_role, reviewed_by, reviewed_at)
  values (v_barangay,
          (select e.event_id from public.disaster_events e where e.barangay_id = v_barangay and e.status = 'active'
           order by e.declared_at desc limit 1),
          upper(p_type), btrim(coalesce(p_description, '')), p_lat, p_lng, p_photo_path, v_status, auth.uid(), v_role,
          case when v_status = 'confirmed' then auth.uid() end,
          case when v_status = 'confirmed' then clock_timestamp() end)
  returning hazard_id into v_id;
  return v_id;
end;
$$;

create or replace function public.review_hazard(p_hazard_id uuid, p_action text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare h public.hazard_reports; v_status text;
begin
  select * into h from public.hazard_reports where hazard_id = p_hazard_id for update;
  if not found then raise exception 'Hazard report not found.'; end if;
  if not (public.is_active_rescuer() or public.staff_can_access_barangay(h.barangay_id)) then
    raise exception 'Only rescuers and the barangay''s staff can review hazards.' using errcode = '42501';
  end if;
  v_status := case p_action when 'confirm' then 'confirmed' when 'review' then 'under_review'
                            when 'dismiss' then 'dismissed' when 'resolve' then 'resolved' end;
  if v_status is null then raise exception 'Unknown review action.'; end if;
  if v_status = h.status then raise exception 'The hazard already has this status.'; end if;
  if v_status in ('dismissed', 'under_review') and btrim(coalesce(p_note, '')) = '' then
    raise exception 'Say why.';
  end if;
  update public.hazard_reports set status = v_status, reviewed_by = auth.uid(), reviewed_at = clock_timestamp(),
    review_note = nullif(left(btrim(coalesce(p_note, '')), 500), ''), updated_at = clock_timestamp()
  where hazard_id = p_hazard_id;
end;
$$;

-- Hazard photos: same private, own-folder rule as the other uploads.
insert into storage.buckets (id, name, public) values ('hazard-photos', 'hazard-photos', false)
  on conflict (id) do update set public = false;
alter policy prioritycare_upload_own on storage.objects
  with check (bucket_id in ('verification-docs', 'house-facades', 'hazard-photos')
              and (storage.foldername(name))[1] = auth.uid()::text);
alter policy prioritycare_read_uploads on storage.objects
  using (bucket_id in ('verification-docs', 'house-facades', 'hazard-photos') and (
    (storage.foldername(name))[1] = auth.uid()::text
    or (bucket_id <> 'hazard-photos'
        and case when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                 then public.staff_can_access_resident(((storage.foldername(name))[1])::uuid) else false end)
    or (bucket_id in ('house-facades', 'hazard-photos') and public.is_active_rescuer())
    or (bucket_id = 'hazard-photos' and public.is_active_staff())
  ));

-- ---------------------------------------------------------------
-- 3. Evacuation of members and walk-ins
-- ---------------------------------------------------------------

-- Members and walk-ins are read by their barangay's staff; rescuers read every record (shelter rosters).
create policy evacuation_records_select_people on public.evacuation_records for select to authenticated
  using (public.is_active_rescuer() or (resident_uid is null and public.staff_can_access_barangay(barangay_id)));

-- Occupancy: latest record per person (or walk-in group), counting each group's headcount.
create or replace function public.recorded_facility_occupancy(p_center_id integer)
returns integer language sql security definer set search_path = '' as $$
  select coalesce(sum(headcount), 0)::integer from (
    select distinct on (coalesce(resident_uid, member_id, record_id)) evac_center_id, evac_status, headcount
    from public.evacuation_records
    order by coalesce(resident_uid, member_id, record_id), logged_at desc nulls last, record_id desc
  ) latest where evac_center_id = p_center_id and evac_status::text = 'safely_evacuated';
$$;

create or replace function public.member_latest_evacuation(p_member uuid)
returns table (evac_status text, center_id integer, center_name text, logged_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select er.evac_status::text, er.evac_center_id, c.center_name, er.logged_at
  from public.evacuation_records er left join public.evacuation_centers c on c.center_id = er.evac_center_id
  where er.member_id = p_member
  order by er.logged_at desc nulls last, er.record_id desc limit 1
$$;
revoke all on function public.member_latest_evacuation(uuid) from public, anon, authenticated;

-- Rescuers (any barangay) and staff (their barangay) log a resident's or member's status.
create or replace function public.record_evacuation(p_resident_uid uuid, p_member_id uuid, p_center_id integer, p_status text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_barangay integer; v_id uuid; v_rescuer boolean := public.is_active_rescuer();
begin
  if (p_resident_uid is null) = (p_member_id is null) then
    raise exception 'Choose one person: a registered resident or a household member.';
  end if;
  if p_status is null or p_status not in ('pending', 'in_transit', 'safely_evacuated', 'failed') then
    raise exception 'Unknown evacuation status.';
  end if;
  if p_status = 'safely_evacuated' and p_center_id is null then
    raise exception 'Choose the evacuation center.';
  end if;
  if p_resident_uid is not null then
    select barangay_id into v_barangay from public.residents where uid = p_resident_uid;
  else
    select h.barangay_id into v_barangay from public.household_members m
      join public.households h on h.household_id = m.household_id where m.member_id = p_member_id;
  end if;
  if v_barangay is null then raise exception 'Person not found.'; end if;
  if not (v_rescuer or public.staff_can_access_barangay(v_barangay)) then
    raise exception 'Only rescuers and the barangay''s staff can log evacuations.' using errcode = '42501';
  end if;
  insert into public.evacuation_records (resident_uid, member_id, barangay_id, rescuer_uid, evac_center_id, evac_status,
                                         evacuated_at, logged_at)
  values (p_resident_uid, p_member_id, v_barangay, case when v_rescuer then auth.uid() end, p_center_id,
          p_status::public.evac_status_type,
          case when p_status = 'safely_evacuated' then clock_timestamp() end, clock_timestamp())
  returning record_id into v_id;
  return v_id;
end;
$$;

-- Walk-in group checked in at a shelter without a registration.
create or replace function public.admit_walk_in(p_center_id integer, p_name text, p_barangay_id integer,
                                                p_sitio text, p_headcount integer, p_needs text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_rescuer boolean := public.is_active_rescuer(); v_id uuid;
begin
  if not (v_rescuer or public.is_active_staff()) then
    raise exception 'Only rescuers and staff can admit walk-ins.' using errcode = '42501';
  end if;
  if p_barangay_id is not null and not (v_rescuer or public.staff_can_access_barangay(p_barangay_id)) then
    raise exception 'You can only admit walk-ins from your barangay.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'Enter the name of the group''s contact person.'; end if;
  if p_center_id is null then raise exception 'Choose the evacuation center.'; end if;
  insert into public.evacuation_records (walkin_name, walkin_sitio, barangay_id, headcount, needs, rescuer_uid,
                                         evac_center_id, evac_status, evacuated_at, logged_at)
  values (btrim(p_name), btrim(coalesce(p_sitio, '')), p_barangay_id, coalesce(p_headcount, 1),
          btrim(coalesce(p_needs, '')), case when v_rescuer then auth.uid() end, p_center_id,
          'safely_evacuated', clock_timestamp(), clock_timestamp())
  returning record_id into v_id;
  return v_id;
end;
$$;

-- Missing household members (no login of their own).
alter table public.missing_person_reports
  add column if not exists member_id uuid references public.household_members(member_id) on delete set null;
create unique index if not exists missing_person_reports_open_member on public.missing_person_reports(member_id)
  where status = 'missing' and member_id is not null;

create or replace function public.set_my_member_missing(p_member_id uuid, p_missing boolean, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.household_members; h public.households; me public.users; rep public.missing_person_reports;
begin
  select * into m from public.household_members where member_id = p_member_id;
  if not found or m.household_id is distinct from public.resident_household_id(auth.uid()) then
    raise exception 'This person is not in your household.';
  end if;
  select * into h from public.households where household_id = m.household_id;
  select * into me from public.users where uid = auth.uid();
  if p_missing then
    insert into public.missing_person_reports (barangay_id, event_id, member_id, full_name, sex, approx_age,
        last_seen_location, reporter_name, reporter_contact, notes, reported_by)
    values (h.barangay_id,
            (select e.event_id from public.disaster_events e where e.barangay_id = h.barangay_id and e.status = 'active'
             order by e.declared_at desc limit 1),
            m.member_id, m.full_name, m.sex, extract(year from age(m.birthdate))::integer,
            left(concat_ws(', ', nullif(h.sitio, ''), (select barangay_name from public.barangays where barangay_id = h.barangay_id)), 500),
            concat_ws(' ', me.f_name, me.l_name), me.contact_no, left(btrim(coalesce(p_note, '')), 2000), auth.uid())
    returning * into rep;
    insert into public.missing_person_report_audit (report_id, action, actor_uid, details)
    values (rep.report_id, 'reported', auth.uid(), to_jsonb(rep));
  else
    update public.missing_person_reports set status = 'found', reconciled_at = clock_timestamp(),
      reconciled_by = auth.uid(), reconciliation_note = left(coalesce(nullif(btrim(p_note), ''), 'Household reported this person safe.'), 1000)
    where member_id = p_member_id and status = 'missing'
    returning * into rep;
    if not found then raise exception 'This person has no open missing report.'; end if;
    insert into public.missing_person_report_audit (report_id, action, actor_uid, details)
    values (rep.report_id, 'found', auth.uid(), jsonb_build_object('note', rep.reconciliation_note));
  end if;
exception when unique_violation then
  raise exception 'This person is already reported missing.';
end;
$$;

-- Household roster with each person's latest evacuation status, for the resident app.
create or replace function public.get_my_household_status()
returns jsonb language sql stable security definer set search_path = '' as $$
  with hh as (select public.resident_household_id(auth.uid()) household_id)
  select jsonb_build_object(
    'household_id', (select household_id from hh),
    'people',
      (select coalesce(jsonb_agg(p order by p->>'kind' desc, p->>'name'), '[]'::jsonb) from (
        select jsonb_build_object('kind', 'resident', 'uid', r.uid, 'name', concat_ws(' ', u.f_name, u.l_name),
          'mobility', r.mobility_status, 'evac_status', le.evac_status, 'center_name', c.center_name,
          'missing', exists (select 1 from public.missing_person_reports mr where mr.resident_uid = r.uid and mr.status = 'missing')) p
        from public.residents r join public.users u on u.uid = r.uid
        left join lateral (select er.evac_status::text evac_status, er.evac_center_id from public.evacuation_records er
          where er.resident_uid = r.uid order by er.logged_at desc nulls last, er.record_id desc limit 1) le on true
        left join public.evacuation_centers c on c.center_id = le.evac_center_id
        where r.uid = auth.uid()
           or r.uid in (select d.resident_uid from public.resident_profile_details d, hh where d.household_id = hh.household_id)
        union all
        select jsonb_build_object('kind', 'member', 'member_id', m.member_id, 'name', m.full_name,
          'relationship', m.relationship, 'age_group', m.age_group, 'mobility', m.mobility, 'needs', m.needs,
          'evac_status', le.evac_status, 'center_name', le.center_name,
          'missing', exists (select 1 from public.missing_person_reports mr where mr.member_id = m.member_id and mr.status = 'missing'))
        from hh join public.household_members m on m.household_id = hh.household_id
        left join lateral public.member_latest_evacuation(m.member_id) le on true
      ) people(p))
  )
$$;

-- ---------------------------------------------------------------
-- 4. Rescuer app feed
-- ---------------------------------------------------------------
create policy dispatch_tickets_read on public.dispatch_tickets for select to authenticated using (
  public.staff_can_access_barangay(barangay_id)
  or exists (select 1 from public.rescue_units un where un.unit_id = dispatch_tickets.assigned_unit_id
             and auth.uid() = any(un.member_uids)));
grant select on public.dispatch_tickets to authenticated;

create or replace function public.household_people_json(p_household uuid, p_head uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(p), '[]'::jsonb) from (
    select jsonb_build_object('kind', 'resident', 'uid', r.uid, 'name', concat_ws(' ', u.f_name, u.l_name),
      'mobility', r.mobility_status, 'birthdate', r.birthdate,
      'evac_status', public.latest_evacuation_status(r.uid)) p
    from public.residents r join public.users u on u.uid = r.uid
    where r.uid = p_head or r.uid in (select d.resident_uid from public.resident_profile_details d where d.household_id = p_household)
    union all
    select jsonb_build_object('kind', 'member', 'member_id', m.member_id, 'name', m.full_name,
      'relationship', m.relationship, 'age_group', m.age_group, 'mobility', m.mobility, 'needs', m.needs,
      'is_pregnant', m.is_pregnant, 'evac_status', (select le.evac_status from public.member_latest_evacuation(m.member_id) le))
    from public.household_members m where m.household_id = p_household
  ) people
$$;
revoke all on function public.household_people_json(uuid, uuid) from public, anon, authenticated;

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
          'cancel_reason', a.cancel_reason, 'created_at', a.created_at) end,
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

-- Residents' map: open centres with occupancy, and confirmed hazards (RLS applies to the table too).
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
      from public.hazard_reports z where z.status = 'confirmed' and z.created_at > now() - interval '7 days'))
  where public.is_active_user()
$$;

-- ---------------------------------------------------------------
-- 5. ID types (centre amenities are added at the top)
-- ---------------------------------------------------------------

alter table public.document_types add column if not exists code text unique;
update public.document_types set code = v.code
from (values (1, 'brgy'), (2, 'philsys'), (3, 'pwd'), (4, 'senior'), (5, 'medical'), (6, 'prc'), (7, 'other')) v(type_id, code)
where document_types.type_id = v.type_id and document_types.code is null;
insert into public.document_types (type_id, type_name, description, code) values
  (8, 'COMELEC Voter''s ID / Certificate', 'Registered Cordova voter record', 'voters'),
  (9, '4Ps DSWD Pantawid Card', 'Household beneficiary credential', '4ps')
on conflict do nothing;

-- ---------------------------------------------------------------
-- Grants and live updates
-- ---------------------------------------------------------------
revoke all on function public.get_my_sos(), public.raise_sos(text, numeric, numeric, text), public.cancel_my_sos(text),
  public.report_hazard(text, text, numeric, numeric, integer, text), public.review_hazard(uuid, text, text),
  public.record_evacuation(uuid, uuid, integer, text), public.admit_walk_in(integer, text, integer, text, integer, text),
  public.set_my_member_missing(uuid, boolean, text), public.get_my_household_status(), public.get_rescuer_feed(),
  public.get_public_map(), public.nearest_barangay(numeric, numeric)
  from public, anon;
grant execute on function public.get_my_sos(), public.raise_sos(text, numeric, numeric, text), public.cancel_my_sos(text),
  public.report_hazard(text, text, numeric, numeric, integer, text), public.review_hazard(uuid, text, text),
  public.record_evacuation(uuid, uuid, integer, text), public.admit_walk_in(integer, text, integer, text, integer, text),
  public.set_my_member_missing(uuid, boolean, text), public.get_my_household_status(), public.get_rescuer_feed(),
  public.get_public_map(), public.nearest_barangay(numeric, numeric)
  to authenticated;
revoke all on function public.resolve_sos_from_ticket() from public, anon, authenticated;

-- Let the app subscribe to changes (row access rules still apply).
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['sos_alerts', 'hazard_reports', 'dispatch_tickets', 'evacuation_records'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                     and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
