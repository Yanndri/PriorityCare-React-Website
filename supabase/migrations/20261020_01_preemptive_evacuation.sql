-- PriorityCare: Log Resident Pre-emptive Evacuation Status & Intended Destination
-- =================================================================
-- Run after 20261019_14. One transaction.
--
-- Before (or early in) a hazard, a household says whether it is staying home,
-- getting ready to leave, on the way, or has arrived, and where it is going:
-- an evacuation center, a relative's or friend's house, or another safe place.
--
-- 1. preemptive_evacuation_logs: one row per report, newest row = current
--    status. Linked to the resident, household, barangay and (when one is
--    active in that barangay) the disaster event.
-- 2. Residents report from the app: report_my_preemptive_evacuation and
--    get_my_preemptive_evacuation (includes the barangay's assigned shelters).
-- 3. Barangay staff (their barangay), super admins (any) and rescuers log for a
--    resident: log_preemptive_evacuation. The website reads
--    get_preemptive_evacuation_board and get_preemptive_evacuation_history.
-- 4. When the destination is an evacuation center, "on the way" and "arrived"
--    also write the matching evacuation_records row (in_transit /
--    safely_evacuated), so center occupancy and reports stay in step.
-- 5. Fix: evacuation_records.record_id had no default, so every insert that
--    left it out failed (record_evacuation and admit_walk_in included).

begin;

alter table public.evacuation_records alter column record_id set default gen_random_uuid();

create table if not exists public.preemptive_evacuation_logs (
  log_id uuid primary key default gen_random_uuid(),
  resident_uid uuid not null references public.residents(uid) on delete cascade,
  household_id uuid references public.households(household_id) on delete set null,
  barangay_id integer not null references public.barangays(barangay_id),
  event_id uuid references public.disaster_events(event_id) on delete set null,
  status text not null check (status in ('staying_home', 'preparing', 'evacuating', 'arrived', 'returned_home')),
  destination_type text check (destination_type in ('evacuation_center', 'relative_friend', 'other')),
  destination_center_id integer references public.evacuation_centers(center_id) on delete set null,
  destination_address text not null default '' check (char_length(destination_address) <= 300),
  headcount integer not null default 1 check (headcount between 1 and 50),
  note text not null default '' check (char_length(note) <= 500),
  source text not null check (source in ('resident', 'staff', 'rescuer')),
  reported_by uuid not null,
  logged_at timestamptz not null default now(),
  constraint preemptive_destination_matches_status check (
    case
      when status in ('staying_home', 'returned_home') then destination_type is null
      when destination_type is null then false
      -- The center id can go null later if the center is deleted, so it is only required on insert.
      when destination_type = 'evacuation_center' then true
      else btrim(destination_address) <> ''
    end
  )
);

create index if not exists preemptive_evacuation_logs_latest
  on public.preemptive_evacuation_logs (resident_uid, logged_at desc, log_id desc);
create index if not exists preemptive_evacuation_logs_barangay
  on public.preemptive_evacuation_logs (barangay_id, logged_at desc);

-- All access goes through the functions below.
alter table public.preemptive_evacuation_logs enable row level security;
revoke all on table public.preemptive_evacuation_logs from public, anon, authenticated;

-- ---------------------------------------------------------------
-- Shared insert (validation lives here; callers check who may log)
-- ---------------------------------------------------------------
create or replace function public.insert_preemptive_evacuation_log(
  p_resident_uid uuid, p_event_id uuid, p_status text, p_destination_type text, p_center_id integer,
  p_destination_address text, p_headcount integer, p_note text, p_source text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  r public.residents;
  v_household uuid;
  v_event uuid := p_event_id;
  v_type text := nullif(btrim(coalesce(p_destination_type, '')), '');
  v_address text := btrim(coalesce(p_destination_address, ''));
  v_center integer := p_center_id;
  v_headcount integer;
  v_id uuid;
begin
  select * into r from public.residents where uid = p_resident_uid;
  if not found then raise exception 'Resident not found.'; end if;

  if p_status is null or p_status not in ('staying_home', 'preparing', 'evacuating', 'arrived', 'returned_home') then
    raise exception 'Choose the evacuation status.';
  end if;

  if p_status in ('staying_home', 'returned_home') then
    v_type := null; v_center := null; v_address := '';
  else
    if v_type is null or v_type not in ('evacuation_center', 'relative_friend', 'other') then
      raise exception 'Choose where the household is going.';
    end if;
    if v_type = 'evacuation_center' then
      v_address := '';
      if v_center is null then raise exception 'Choose the evacuation center.'; end if;
      if not exists (select 1 from public.evacuation_centers c
                     where c.center_id = v_center and coalesce(c.status, 'open') <> 'closed') then
        raise exception 'That evacuation center is closed or does not exist. Choose another one.';
      end if;
    else
      v_center := null;
      if v_address = '' then raise exception 'Enter the address or place the household is going to.'; end if;
      if char_length(v_address) > 300 then raise exception 'Keep the destination under 300 characters.'; end if;
    end if;
  end if;

  if char_length(btrim(coalesce(p_note, ''))) > 500 then raise exception 'Keep the note under 500 characters.'; end if;

  v_household := public.resident_household_id(p_resident_uid);
  v_headcount := coalesce(p_headcount,
    1 + (select count(*) from public.household_members m where m.household_id = v_household)::integer);
  if v_headcount < 1 or v_headcount > 50 then raise exception 'Headcount must be between 1 and 50.'; end if;

  if v_event is not null then
    if not exists (select 1 from public.disaster_events e
                   where e.event_id = v_event and e.barangay_id = r.barangay_id and e.status = 'active') then
      raise exception 'The disaster event must be active and in the resident''s barangay.';
    end if;
  else
    select e.event_id into v_event from public.disaster_events e
    where e.barangay_id = r.barangay_id and e.status = 'active'
    order by e.started_at desc limit 1;
  end if;

  insert into public.preemptive_evacuation_logs (resident_uid, household_id, barangay_id, event_id, status,
      destination_type, destination_center_id, destination_address, headcount, note, source, reported_by, logged_at)
    values (p_resident_uid, v_household, r.barangay_id, v_event, p_status, v_type, v_center, v_address,
      v_headcount, btrim(coalesce(p_note, '')), p_source, auth.uid(), clock_timestamp())
    returning log_id into v_id;

  -- Keep the evacuation center records in step.
  if v_type = 'evacuation_center' and p_status in ('evacuating', 'arrived') then
    insert into public.evacuation_records (resident_uid, barangay_id, rescuer_uid, evac_center_id, evac_status,
                                           evacuated_at, logged_at)
    values (p_resident_uid, r.barangay_id, case when p_source = 'rescuer' then auth.uid() end, v_center,
            case when p_status = 'arrived' then 'safely_evacuated' else 'in_transit' end::public.evac_status_type,
            case when p_status = 'arrived' then clock_timestamp() end, clock_timestamp());
  end if;

  return v_id;
end;
$$;
revoke all on function public.insert_preemptive_evacuation_log(uuid, uuid, text, text, integer, text, integer, text, text)
  from public, anon, authenticated;

-- One log entry as JSON (shared by the app and the website).
create or replace function public.preemptive_log_json(p_log public.preemptive_evacuation_logs)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when p_log.log_id is null then null else jsonb_build_object(
    'log_id', p_log.log_id,
    'status', p_log.status,
    'destination_type', p_log.destination_type,
    'destination_center_id', p_log.destination_center_id,
    'destination_center_name', (select c.center_name from public.evacuation_centers c where c.center_id = p_log.destination_center_id),
    'destination_address', p_log.destination_address,
    'headcount', p_log.headcount,
    'note', p_log.note,
    'event_id', p_log.event_id,
    'event_name', (select e.name from public.disaster_events e where e.event_id = p_log.event_id),
    'source', p_log.source,
    'reported_by_name', (select btrim(concat_ws(' ', u.f_name, u.l_name)) from public.users u where u.uid = p_log.reported_by),
    'logged_at', p_log.logged_at) end
$$;
revoke all on function public.preemptive_log_json(public.preemptive_evacuation_logs) from public, anon, authenticated;

-- ---------------------------------------------------------------
-- Resident app
-- ---------------------------------------------------------------
create or replace function public.get_my_preemptive_evacuation()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
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
    'active_event', (select jsonb_build_object('event_id', e.event_id, 'name', e.name, 'hazard_type', e.hazard_type)
                     from public.disaster_events e where e.barangay_id = r.barangay_id and e.status = 'active'
                     order by e.started_at desc limit 1),
    -- The barangay's assigned shelters first (primary, then alternates), then every other open center.
    'centers', coalesce((select jsonb_agg(jsonb_build_object(
        'center_id', c.center_id, 'center_name', c.center_name, 'gps_lat', c.gps_lat, 'gps_long', c.gps_long,
        'capacity', c.capacity, 'assigned', c.center_id = v_plan.primary_center_id or c.center_id = any(coalesce(v_plan.alternate_center_ids, '{}')),
        'is_primary', c.center_id = v_plan.primary_center_id)
        order by (c.center_id = v_plan.primary_center_id) desc nulls last,
                 (c.center_id = any(coalesce(v_plan.alternate_center_ids, '{}'))) desc nulls last, c.center_name)
      from public.evacuation_centers c where coalesce(c.status, 'open') <> 'closed'), '[]'::jsonb));
end;
$$;
revoke all on function public.get_my_preemptive_evacuation() from public, anon;
grant execute on function public.get_my_preemptive_evacuation() to authenticated;

create or replace function public.report_my_preemptive_evacuation(
  p_status text, p_destination_type text, p_center_id integer, p_destination_address text,
  p_headcount integer, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.residents where uid = auth.uid()) then
    raise exception 'Only registered residents can report evacuation status.';
  end if;
  if not exists (select 1 from public.users where uid = auth.uid() and account_status = 'active') then
    raise exception 'This account is not active.';
  end if;
  perform public.insert_preemptive_evacuation_log(auth.uid(), null, p_status, p_destination_type, p_center_id,
    p_destination_address, p_headcount, p_note, 'resident');
  return public.get_my_preemptive_evacuation();
end;
$$;
revoke all on function public.report_my_preemptive_evacuation(text, text, integer, text, integer, text) from public, anon;
grant execute on function public.report_my_preemptive_evacuation(text, text, integer, text, integer, text) to authenticated;

-- ---------------------------------------------------------------
-- Staff (website) and rescuers
-- ---------------------------------------------------------------
create or replace function public.log_preemptive_evacuation(
  p_resident_uid uuid, p_event_id uuid, p_status text, p_destination_type text, p_center_id integer,
  p_destination_address text, p_headcount integer, p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_rescuer boolean := public.is_active_rescuer();
begin
  if p_resident_uid is null then raise exception 'Choose a resident.'; end if;
  if not (v_rescuer or public.staff_can_access_resident(p_resident_uid)) then
    raise exception 'Only rescuers and the resident''s barangay staff can log evacuation status.' using errcode = '42501';
  end if;
  return public.insert_preemptive_evacuation_log(p_resident_uid, p_event_id, p_status, p_destination_type, p_center_id,
    p_destination_address, p_headcount, p_note, case when v_rescuer then 'rescuer' else 'staff' end);
end;
$$;
revoke all on function public.log_preemptive_evacuation(uuid, uuid, text, text, integer, text, integer, text) from public, anon;
grant execute on function public.log_preemptive_evacuation(uuid, uuid, text, text, integer, text, integer, text) to authenticated;

-- Every resident in scope with their latest report. Admins: their barangay.
-- Super admins: p_barangay, or every barangay when it is null.
create or replace function public.get_preemptive_evacuation_board(p_barangay integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_super boolean := public.is_active_super_admin(); v_scope integer;
begin
  if v_super then
    v_scope := p_barangay;
  else
    select u.assigned_barangay_id into v_scope from public.users u
      where u.uid = auth.uid() and u.account_status = 'active' and u.role::text = 'admin';
    if v_scope is null then raise exception 'Only barangay staff can view evacuation status.' using errcode = '42501'; end if;
  end if;

  return jsonb_build_object(
    'barangays', coalesce((select jsonb_agg(jsonb_build_object('barangay_id', b.barangay_id, 'barangay_name', b.barangay_name)
        order by b.barangay_name)
      from public.barangays b where v_scope is null or b.barangay_id = v_scope), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('event_id', e.event_id, 'barangay_id', e.barangay_id,
        'name', e.name, 'hazard_type', e.hazard_type) order by e.started_at desc)
      from public.disaster_events e where e.status = 'active' and (v_scope is null or e.barangay_id = v_scope)), '[]'::jsonb),
    'centers', coalesce((select jsonb_agg(jsonb_build_object('center_id', c.center_id, 'center_name', c.center_name,
        'barangay_id', c.barangay_id) order by c.center_name)
      from public.evacuation_centers c where coalesce(c.status, 'open') <> 'closed'), '[]'::jsonb),
    'residents', coalesce((select jsonb_agg(x.row order by x.name) from (
      select btrim(concat_ws(' ', u.f_name, u.l_name)) as name, jsonb_build_object(
        'uid', r.uid,
        'name', btrim(concat_ws(' ', u.f_name, u.l_name)),
        'barangay_id', r.barangay_id,
        'barangay_name', b.barangay_name,
        'sitio', r.sitio,
        'mobility', r.mobility_status,
        'household_name', h.household_name,
        'household_size', 1 + (select count(*) from public.household_members m where m.household_id = h.household_id),
        'latest', public.preemptive_log_json(l)) as row
      from public.residents r
      join public.users u on u.uid = r.uid
      join public.barangays b on b.barangay_id = r.barangay_id
      left join public.households h on h.household_id = public.resident_household_id(r.uid)
      left join lateral (select * from public.preemptive_evacuation_logs pl where pl.resident_uid = r.uid
                         order by pl.logged_at desc, pl.log_id desc limit 1) l on true
      where v_scope is null or r.barangay_id = v_scope) x), '[]'::jsonb));
end;
$$;
revoke all on function public.get_preemptive_evacuation_board(integer) from public, anon;
grant execute on function public.get_preemptive_evacuation_board(integer) to authenticated;

create or replace function public.get_preemptive_evacuation_history(p_resident_uid uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.staff_can_access_resident(p_resident_uid) then
    raise exception 'You can only view residents in your barangay.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(public.preemptive_log_json(l) order by l.logged_at desc, l.log_id desc)
    from public.preemptive_evacuation_logs l where l.resident_uid = p_resident_uid), '[]'::jsonb);
end;
$$;
revoke all on function public.get_preemptive_evacuation_history(uuid) from public, anon;
grant execute on function public.get_preemptive_evacuation_history(uuid) to authenticated;

commit;
