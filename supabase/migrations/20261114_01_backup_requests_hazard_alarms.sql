-- STEP 20 (2026-11-14): backup requests, nearby hazard confirmations ("2nd / 3rd alarm"),
-- and hazards only inside Cordova.
-- Run once in the Supabase SQL Editor. Safe to run again.
--
-- 1. Backup requests: a responder on an assigned ticket asks for extra help
--    (rescue boat, ambulance, stretcher, road clearing, more people). The web
--    SOS & Rescue board shows them; an admin marks them handled.
-- 2. Hazard confirmations: people near a new hazard pin can say "I see it too".
--    Alarm level = 1 + confirmations + other open reports of the same type
--    within 300 m in the last 6 hours (the advisor's 2nd / 3rd alarm).
-- 3. report_hazard refuses pins outside every Cordova barangay border.

begin;

-- ---------------------------------------------------------------- 1. backup requests
create table if not exists public.ticket_backup_requests (
  request_id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.dispatch_tickets(ticket_id) on delete cascade,
  need text not null check (need in ('boat', 'ambulance', 'stretcher', 'road_clearing', 'more_people')),
  note text,
  status text not null default 'open' check (status in ('open', 'handled', 'cancelled')),
  requested_by uuid not null references public.users(uid),
  requested_at timestamptz not null default now(),
  handled_by uuid references public.users(uid),
  handled_at timestamptz
);
create unique index if not exists ticket_backup_one_open
  on public.ticket_backup_requests (ticket_id, need) where status = 'open';
alter table public.ticket_backup_requests enable row level security;
-- No direct table access; everything goes through the functions below.
revoke all on public.ticket_backup_requests from anon, authenticated;

drop trigger if exists live_signal on public.ticket_backup_requests;
create trigger live_signal after insert or update or delete on public.ticket_backup_requests
  for each statement execute function public.bump_live_signal('tickets');

-- A member of the unit assigned to a live ticket asks for backup.
create or replace function public.request_backup(p_ticket_id uuid, p_need text, p_note text default null)
returns uuid language plpgsql security definer set search_path to '' as $$
declare t public.dispatch_tickets; v_id uuid;
begin
  select * into t from public.dispatch_tickets where ticket_id = p_ticket_id;
  if not found then raise exception 'Ticket not found.'; end if;
  if not public.is_active_rescuer() or t.assigned_unit_id is null
     or not (auth.uid() = any (public.unit_members(t.assigned_unit_id))) then
    raise exception 'Only the unit assigned to this SOS can ask for backup.' using errcode = '42501';
  end if;
  if t.status in ('resolved', 'cancelled') then raise exception 'This SOS is already closed.'; end if;
  if p_need not in ('boat', 'ambulance', 'stretcher', 'road_clearing', 'more_people') then
    raise exception 'Choose what you need.';
  end if;
  select request_id into v_id from public.ticket_backup_requests
    where ticket_id = p_ticket_id and need = p_need and status = 'open';
  if v_id is not null then return v_id; end if; -- already asked
  insert into public.ticket_backup_requests (ticket_id, need, note, requested_by)
  values (p_ticket_id, p_need, nullif(left(btrim(coalesce(p_note, '')), 300), ''), auth.uid())
  returning request_id into v_id;
  return v_id;
end $$;

-- The responder withdraws it, or staff of the ticket's barangay mark it handled.
create or replace function public.close_backup_request(p_request_id uuid, p_action text)
returns void language plpgsql security definer set search_path to '' as $$
declare r public.ticket_backup_requests; t public.dispatch_tickets;
begin
  select * into r from public.ticket_backup_requests where request_id = p_request_id for update;
  if not found then raise exception 'Backup request not found.'; end if;
  if r.status <> 'open' then return; end if;
  select * into t from public.dispatch_tickets where ticket_id = r.ticket_id;
  if p_action = 'cancel' then
    if r.requested_by <> auth.uid() and not public.staff_can_access_barangay(t.barangay_id) then
      raise exception 'Only the responder who asked can cancel it.' using errcode = '42501';
    end if;
  elsif p_action = 'handled' then
    if not public.staff_can_access_barangay(t.barangay_id) then
      raise exception 'Only the barangay''s staff can mark backup as handled.' using errcode = '42501';
    end if;
  else
    raise exception 'Unknown action.';
  end if;
  update public.ticket_backup_requests
     set status = case p_action when 'cancel' then 'cancelled' else 'handled' end,
         handled_by = auth.uid(), handled_at = clock_timestamp()
   where request_id = p_request_id;
end $$;

-- Open backup requests the caller may see: staff see their scope, responders
-- see the requests on tickets assigned to their units.
create or replace function public.get_backup_requests()
returns table (request_id uuid, ticket_id uuid, ticket_no bigint, barangay_id integer, need text, note text,
               requested_at timestamptz, requested_by_name text, unit_name text)
language sql stable security definer set search_path to '' as $$
  select r.request_id, r.ticket_id, t.ticket_no, t.barangay_id, r.need, r.note, r.requested_at,
         concat_ws(' ', u.f_name, u.l_name), un.unit_name
  from public.ticket_backup_requests r
  join public.dispatch_tickets t on t.ticket_id = r.ticket_id
  left join public.users u on u.uid = r.requested_by
  left join public.rescue_units un on un.unit_id = t.assigned_unit_id
  where r.status = 'open'
    and (public.staff_can_access_barangay(t.barangay_id)
         or (t.assigned_unit_id is not null and auth.uid() = any (public.unit_members(t.assigned_unit_id))))
  order by r.requested_at
$$;

-- ---------------------------------------------------------------- 2. hazard confirmations
create table if not exists public.hazard_confirmations (
  hazard_id uuid not null references public.hazard_reports(hazard_id) on delete cascade,
  uid uuid not null references public.users(uid),
  confirmed_at timestamptz not null default now(),
  primary key (hazard_id, uid)
);
alter table public.hazard_confirmations enable row level security;
revoke all on public.hazard_confirmations from anon, authenticated;

drop trigger if exists live_signal on public.hazard_confirmations;
create trigger live_signal after insert or update or delete on public.hazard_confirmations
  for each statement execute function public.bump_live_signal('hazards');

-- Distance in metres between two points (haversine).
create or replace function public.distance_m(lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric)
returns double precision language sql immutable set search_path to '' as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians((lat2 - lat1)::double precision) / 2), 2)
    + cos(radians(lat1::double precision)) * cos(radians(lat2::double precision))
      * power(sin(radians((lng2 - lng1)::double precision) / 2), 2)))
$$;

-- "I see it too": anyone signed in and within 1 km of an open hazard.
create or replace function public.confirm_hazard(p_hazard_id uuid, p_lat numeric, p_lng numeric)
returns void language plpgsql security definer set search_path to '' as $$
declare h public.hazard_reports;
begin
  if not exists (select 1 from public.users where uid = auth.uid() and account_status = 'active') then
    raise exception 'Sign in first.';
  end if;
  select * into h from public.hazard_reports where hazard_id = p_hazard_id;
  if not found or h.status not in ('unverified', 'under_review', 'confirmed') then
    raise exception 'This hazard report is closed.';
  end if;
  if h.reported_by = auth.uid() then raise exception 'You reported this hazard yourself.'; end if;
  if p_lat is null or p_lng is null or public.distance_m(p_lat, p_lng, h.latitude, h.longitude) > 1000 then
    raise exception 'You need to be within 1 km of the hazard to confirm it.';
  end if;
  insert into public.hazard_confirmations (hazard_id, uid) values (p_hazard_id, auth.uid())
  on conflict do nothing;
end $$;

-- Alarm level for every open hazard. Only ids and counts, so any signed-in user may read it.
create or replace function public.get_hazard_alarms()
returns table (hazard_id uuid, alarm_level integer, confirmations integer, nearby_reports integer, confirmed_by_me boolean)
language sql stable security definer set search_path to '' as $$
  select h.hazard_id,
         1 + c.n + nb.n,
         c.n, nb.n,
         exists (select 1 from public.hazard_confirmations x where x.hazard_id = h.hazard_id and x.uid = auth.uid())
  from public.hazard_reports h
  cross join lateral (select count(*)::integer n from public.hazard_confirmations x where x.hazard_id = h.hazard_id) c
  cross join lateral (
    select count(*)::integer n from public.hazard_reports o
    where o.hazard_id <> h.hazard_id and o.hazard_type = h.hazard_type
      and o.status in ('unverified', 'under_review', 'confirmed')
      and o.reported_by is distinct from h.reported_by
      and abs(extract(epoch from (o.created_at - h.created_at))) <= 6 * 3600
      and public.distance_m(o.latitude, o.longitude, h.latitude, h.longitude) <= 300) nb
  where h.status in ('unverified', 'under_review', 'confirmed')
    and exists (select 1 from public.users where uid = auth.uid() and account_status = 'active')
$$;

-- Open hazards reported by someone else in the last 6 hours within 1 km of the caller,
-- so the app can ask "Do you see it too?". Residents cannot read unconfirmed reports
-- directly, so this returns only what the prompt needs.
create or replace function public.get_nearby_hazards(p_lat numeric, p_lng numeric)
returns table (hazard_id uuid, hazard_type text, description text, latitude numeric, longitude numeric,
               distance_m integer, status text, created_at timestamptz, confirmed_by_me boolean)
language sql stable security definer set search_path to '' as $$
  select h.hazard_id, h.hazard_type::text, h.description, h.latitude, h.longitude,
         round(public.distance_m(p_lat, p_lng, h.latitude, h.longitude))::integer,
         h.status::text, h.created_at,
         exists (select 1 from public.hazard_confirmations x where x.hazard_id = h.hazard_id and x.uid = auth.uid())
  from public.hazard_reports h
  where p_lat is not null and p_lng is not null
    and exists (select 1 from public.users where uid = auth.uid() and account_status = 'active')
    and h.status in ('unverified', 'under_review', 'confirmed')
    and h.reported_by is distinct from auth.uid()
    and h.created_at > now() - interval '6 hours'
    and public.distance_m(p_lat, p_lng, h.latitude, h.longitude) <= 1000
  order by 6
$$;

-- ---------------------------------------------------------------- 3. hazards inside Cordova only
create or replace function public.report_hazard(p_type text, p_description text, p_lat numeric, p_lng numeric, p_barangay_id integer, p_photo_path text)
 returns uuid language plpgsql security definer set search_path to '' as $function$
declare v_role text; v_barangay integer; v_id uuid; v_status text := 'unverified';
begin
  select role::text into v_role from public.users where uid = auth.uid() and account_status = 'active';
  if v_role is null then raise exception 'Sign in to report a hazard.'; end if;
  if upper(coalesce(p_type, '')) not in ('FIRE', 'FLOOD', 'BLOCK', 'WIRE', 'LANDSLIDE', 'OTHER') then
    raise exception 'Choose the type of hazard.';
  end if;
  if p_lat is null or p_lng is null then raise exception 'Pin the hazard on the map.'; end if;
  -- New (STEP 20): the pin must be inside a Cordova barangay.
  if public.barangay_at(p_lat, p_lng) is null then
    raise exception 'That spot is outside Cordova. Hazards can only be reported inside the municipality.';
  end if;
  if p_photo_path is not null and p_photo_path not like auth.uid()::text || '/%' then
    raise exception 'Upload the photo into your own folder first.';
  end if;
  v_barangay := coalesce(p_barangay_id, public.barangay_at(p_lat, p_lng));
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
$function$;

revoke all on function public.request_backup(uuid, text, text) from public, anon;
revoke all on function public.close_backup_request(uuid, text) from public, anon;
revoke all on function public.get_backup_requests() from public, anon;
revoke all on function public.confirm_hazard(uuid, numeric, numeric) from public, anon;
revoke all on function public.get_hazard_alarms() from public, anon;
revoke all on function public.get_nearby_hazards(numeric, numeric) from public, anon;
grant execute on function public.request_backup(uuid, text, text) to authenticated;
grant execute on function public.close_backup_request(uuid, text) to authenticated;
grant execute on function public.get_backup_requests() to authenticated;
grant execute on function public.confirm_hazard(uuid, numeric, numeric) to authenticated;
grant execute on function public.get_hazard_alarms() to authenticated;
grant execute on function public.get_nearby_hazards(numeric, numeric) to authenticated;

commit;

-- Check (should list 6 functions and 2 tables):
select proname from pg_proc where proname in ('request_backup','close_backup_request','get_backup_requests','confirm_hazard','get_hazard_alarms','get_nearby_hazards') order by 1;
select to_regclass('public.ticket_backup_requests') as backup_table, to_regclass('public.hazard_confirmations') as confirm_table;
