-- Module 5.5: issue & assign digital rescue dispatch tickets to responder units.
-- Requires 20261014_disaster_events.sql (assert_disaster_admin) and
-- 20261014_missing_person_reconciliation.sql (missing_person_reports, for intake).
-- New tables + guarded RPCs only. Existing SOS / resident / evacuation rows are never modified.
-- update_dispatch_status() is the hook for the rescuer app (Module 5.6) to progress a ticket.
begin;

create table if not exists public.rescue_units (
  unit_id integer generated always as identity primary key,
  unit_name text not null check (length(btrim(unit_name)) between 1 and 80),
  sitio_id integer references public.sitios(sitio_id),   -- null = barangay-wide unit (super admin manages)
  capabilities text[] not null default '{}' check (cardinality(capabilities) <= 12),
  member_uids uuid[] not null default '{}' check (cardinality(member_uids) <= 20),
  is_active boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
create unique index if not exists rescue_units_name on public.rescue_units(lower(btrim(unit_name)));

create table if not exists public.dispatch_tickets (
  ticket_id uuid primary key default gen_random_uuid(),
  ticket_no bigint generated always as identity unique,
  sitio_id integer not null references public.sitios(sitio_id),
  event_id uuid references public.disaster_events(event_id),
  resident_uid uuid references public.residents(uid),
  subject text not null check (length(btrim(subject)) between 1 and 200),
  source text not null check (source in ('manual','sos','missing_report','triage')),
  source_ref text check (source_ref is null or length(source_ref) <= 100),
  priority text not null check (priority in ('critical','high','normal')),
  latitude numeric, longitude numeric,
  location_note text not null default '' check (length(location_note) <= 500),
  instructions text not null default '' check (length(instructions) <= 2000),
  equipment text[] not null default '{}' check (cardinality(equipment) <= 12),
  status text not null default 'open'
    check (status in ('open','assigned','acknowledged','en_route','on_scene','resolved','cancelled')),
  assigned_unit_id integer references public.rescue_units(unit_id),
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  assigned_at timestamptz,
  closed_at timestamptz,
  closed_by uuid references auth.users(id),
  outcome_note text,
  check ((latitude is null and longitude is null) or
    (latitude between -90 and 90 and longitude between -180 and 180)),
  check (status = 'open' or status in ('resolved','cancelled') or assigned_unit_id is not null),
  check ((status in ('resolved','cancelled')) = (closed_at is not null))
);
-- One live ticket per SOS alert / missing report, so two dispatchers cannot send two teams by accident.
create unique index if not exists dispatch_tickets_live_source
  on public.dispatch_tickets(source, source_ref)
  where source_ref is not null and status not in ('resolved','cancelled');
create index if not exists dispatch_tickets_sitio_status on public.dispatch_tickets(sitio_id, status);

create table if not exists public.dispatch_ticket_events (
  event_no bigint generated always as identity primary key,
  ticket_id uuid not null references public.dispatch_tickets(ticket_id),
  action text not null check (action in ('created','assigned','reassigned','status','resolved','cancelled')),
  from_status text, to_status text,
  unit_id integer references public.rescue_units(unit_id),
  note text,
  actor_uid uuid not null references auth.users(id),
  recorded_at timestamptz not null default clock_timestamp()
);

alter table public.rescue_units enable row level security;
alter table public.dispatch_tickets enable row level security;
alter table public.dispatch_ticket_events enable row level security;
revoke all on public.rescue_units, public.dispatch_tickets, public.dispatch_ticket_events from public, anon, authenticated;

-- ------------------------------------------------------------------ board
create or replace function public.get_dispatch_board()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor_role text; actor_sitio integer;
begin
  perform public.assert_disaster_admin();
  select role::text, assigned_sitio_id into actor_role, actor_sitio from public.users where uid = auth.uid();
  return jsonb_build_object(
    'generated_at', clock_timestamp(),
    'is_super_admin', actor_role = 'super_admin',
    'sitios', (select coalesce(jsonb_agg(jsonb_build_object('sitio_id', s.sitio_id, 'sitio_name', s.sitio_name) order by s.sitio_name), '[]'::jsonb)
      from public.sitios s where actor_role = 'super_admin' or s.sitio_id = actor_sitio),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('event_id', e.event_id, 'sitio_id', e.sitio_id, 'name', e.name, 'hazard_type', e.hazard_type)
        order by e.declared_at desc), '[]'::jsonb)
      from public.disaster_events e where e.status = 'active' and (actor_role = 'super_admin' or e.sitio_id = actor_sitio)),
    -- Live tickets, plus tickets closed in the last 7 days.
    'tickets', (select coalesce(jsonb_agg(jsonb_build_object(
        'ticket_id', t.ticket_id, 'ticket_no', t.ticket_no, 'sitio_id', t.sitio_id, 'event_id', t.event_id,
        'resident_uid', t.resident_uid, 'subject', t.subject, 'source', t.source, 'source_ref', t.source_ref,
        'priority', t.priority, 'latitude', t.latitude, 'longitude', t.longitude, 'location_note', t.location_note,
        'instructions', t.instructions, 'equipment', to_jsonb(t.equipment), 'status', t.status,
        'assigned_unit_id', t.assigned_unit_id, 'created_at', t.created_at, 'assigned_at', t.assigned_at,
        'closed_at', t.closed_at, 'outcome_note', t.outcome_note,
        'created_by_name', (select concat_ws(' ', u.f_name, u.l_name) from public.users u where u.uid = t.created_by),
        'last_update', (select max(ev.recorded_at) from public.dispatch_ticket_events ev where ev.ticket_id = t.ticket_id)
      ) order by case t.priority when 'critical' then 0 when 'high' then 1 else 2 end, t.created_at), '[]'::jsonb)
      from public.dispatch_tickets t
      where (actor_role = 'super_admin' or t.sitio_id = actor_sitio)
        and (t.closed_at is null or t.closed_at > now() - interval '7 days')),
    -- Units are shared: any admin may assign any active unit (e.g. to borrow a team from another sitio).
    'units', (select coalesce(jsonb_agg(jsonb_build_object(
        'unit_id', un.unit_id, 'unit_name', un.unit_name, 'sitio_id', un.sitio_id,
        'capabilities', to_jsonb(un.capabilities), 'member_uids', to_jsonb(un.member_uids), 'is_active', un.is_active,
        'editable', actor_role = 'super_admin' or (un.sitio_id is not null and un.sitio_id = actor_sitio),
        'members', (select coalesce(jsonb_agg(jsonb_build_object('uid', u.uid, 'name', concat_ws(' ', u.f_name, u.l_name), 'contact_no', u.contact_no)
            order by u.l_name), '[]'::jsonb) from public.users u where u.uid = any(un.member_uids)),
        'live_tickets', (select count(*) from public.dispatch_tickets t where t.assigned_unit_id = un.unit_id
            and t.status in ('assigned','acknowledged','en_route','on_scene'))
      ) order by un.is_active desc, un.unit_name), '[]'::jsonb) from public.rescue_units un),
    'rescuers', (select coalesce(jsonb_agg(jsonb_build_object('uid', u.uid, 'name', concat_ws(' ', u.f_name, u.l_name)) order by u.l_name, u.f_name), '[]'::jsonb)
      from public.users u where u.role::text = 'rescuer' and u.account_status = 'active'),
    -- Intake: active SOS alerts and open missing reports in scope that have no live ticket yet.
    'intake_sos', (select coalesce(jsonb_agg(jsonb_build_object(
        'alert_id', a.alert_id, 'resident_uid', r.uid, 'resident_name', concat_ws(' ', u.f_name, u.l_name), 'sitio_id', r.sitio_id,
        'alert_type', a.alert_type, 'alert_level', a.alert_level, 'created_at', a.created_at,
        'latitude', r.gps_lat, 'longitude', r.gps_long) order by a.alert_level desc, a.created_at), '[]'::jsonb)
      from public.sos_alerts a
      join public.residents r on r.uid::text = a.resident_uid
      join public.users u on u.uid = r.uid
      where coalesce(a.status, 'active') = 'active' and (actor_role = 'super_admin' or r.sitio_id = actor_sitio)
        and not exists (select 1 from public.dispatch_tickets t where t.source = 'sos' and t.source_ref = a.alert_id::text
          and t.status not in ('resolved','cancelled'))),
    'intake_missing', (select coalesce(jsonb_agg(jsonb_build_object(
        'report_id', m.report_id, 'resident_uid', m.resident_uid, 'full_name', m.full_name, 'sitio_id', m.sitio_id,
        'last_seen_location', m.last_seen_location, 'last_seen_at', m.last_seen_at, 'reported_at', m.reported_at,
        'latitude', r.gps_lat, 'longitude', r.gps_long) order by m.reported_at), '[]'::jsonb)
      from public.missing_person_reports m
      left join public.residents r on r.uid = m.resident_uid
      where m.status = 'missing' and (actor_role = 'super_admin' or m.sitio_id = actor_sitio)
        and not exists (select 1 from public.dispatch_tickets t where t.source = 'missing_report' and t.source_ref = m.report_id::text
          and t.status not in ('resolved','cancelled')))
  );
end;
$$;
revoke all on function public.get_dispatch_board() from public, anon;
grant execute on function public.get_dispatch_board() to authenticated;

-- ------------------------------------------------------------------ units
-- p_unit_id null = create. Sitio units: that sitio's admin or a super admin. Barangay-wide (null sitio): super admin.
create or replace function public.save_rescue_unit(p_unit_id integer, p_name text, p_sitio integer,
  p_capabilities text[], p_member_uids uuid[], p_active boolean)
returns integer language plpgsql security definer set search_path = '' as $$
declare actor_role text; existing public.rescue_units; result_id integer;
  caps text[] := array(select distinct btrim(c) from unnest(coalesce(p_capabilities, '{}')) c where btrim(c) <> '');
  members uuid[] := array(select distinct m from unnest(coalesce(p_member_uids, '{}')) m where m is not null);
begin
  perform public.assert_disaster_admin();
  select role::text into actor_role from public.users where uid = auth.uid();
  if p_unit_id is not null then
    select * into existing from public.rescue_units where unit_id = p_unit_id for update;
    if not found then raise exception 'Unit was not found.'; end if;
    if existing.sitio_id is null and actor_role <> 'super_admin' then
      raise exception 'Only a super admin can edit barangay-wide units.' using errcode = '42501';
    end if;
    if existing.sitio_id is not null then perform public.assert_disaster_admin(existing.sitio_id); end if;
  end if;
  if p_sitio is null and actor_role <> 'super_admin' then
    raise exception 'Only a super admin can create barangay-wide units. Choose your sitio.' using errcode = '42501';
  end if;
  if p_sitio is not null then perform public.assert_disaster_admin(p_sitio); end if;
  if exists (select 1 from unnest(caps) c where length(c) > 40) then raise exception 'Keep each capability under 40 characters.'; end if;
  if exists (select 1 from unnest(members) m where not exists (
      select 1 from public.users u where u.uid = m and u.role::text = 'rescuer' and u.account_status = 'active')) then
    raise exception 'Unit members must be active rescuer accounts.';
  end if;
  if p_active is false and p_unit_id is not null and exists (select 1 from public.dispatch_tickets t
      where t.assigned_unit_id = p_unit_id and t.status in ('assigned','acknowledged','en_route','on_scene')) then
    raise exception 'Reassign or close this unit''s live tickets before deactivating it.';
  end if;
  if p_unit_id is null then
    insert into public.rescue_units(unit_name, sitio_id, capabilities, member_uids, is_active, updated_by)
      values (btrim(p_name), p_sitio, caps, members, coalesce(p_active, true), auth.uid()) returning unit_id into result_id;
  else
    update public.rescue_units set unit_name = btrim(p_name), sitio_id = p_sitio, capabilities = caps, member_uids = members,
      is_active = coalesce(p_active, true), updated_at = clock_timestamp(), updated_by = auth.uid()
      where unit_id = p_unit_id returning unit_id into result_id;
  end if;
  return result_id;
exception when unique_violation then
  raise exception 'A unit with this name already exists.';
end;
$$;
revoke all on function public.save_rescue_unit(integer, text, integer, text[], uuid[], boolean) from public, anon;
grant execute on function public.save_rescue_unit(integer, text, integer, text[], uuid[], boolean) to authenticated;

-- ------------------------------------------------------------------ tickets
create or replace function public.create_dispatch_ticket(
  p_sitio integer, p_event_id uuid, p_resident_uid uuid, p_subject text, p_source text, p_source_ref text,
  p_priority text, p_lat numeric, p_lng numeric, p_location_note text, p_instructions text, p_equipment text[], p_unit_id integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare t public.dispatch_tickets;
begin
  perform public.assert_disaster_admin(p_sitio);
  if p_sitio is null then raise exception 'Select a sitio.'; end if;
  if p_event_id is not null and not exists (select 1 from public.disaster_events e
      where e.event_id = p_event_id and e.sitio_id = p_sitio and e.status = 'active') then
    raise exception 'The linked disaster event must be active and in the same sitio.';
  end if;
  if p_resident_uid is not null and not exists (select 1 from public.residents r where r.uid = p_resident_uid and r.sitio_id = p_sitio) then
    raise exception 'The resident is not registered in this sitio.';
  end if;
  if p_source not in ('manual','sos','missing_report','triage') then raise exception 'Unknown ticket source.'; end if;
  if p_source = 'sos' and not exists (select 1 from public.sos_alerts a where a.alert_id::text = p_source_ref) then
    raise exception 'SOS alert was not found.';
  end if;
  if p_source = 'missing_report' and not exists (select 1 from public.missing_person_reports m
      where m.report_id::text = p_source_ref and m.status = 'missing' and m.sitio_id = p_sitio) then
    raise exception 'Open missing-person report was not found in this sitio.';
  end if;
  if p_lat is null and p_lng is null and p_resident_uid is null and btrim(coalesce(p_location_note, '')) = '' then
    raise exception 'Give a location: a resident, map coordinates, or a location note.';
  end if;
  if (p_lat is null) <> (p_lng is null) then raise exception 'Provide both coordinates or neither.'; end if;
  if p_unit_id is not null and not exists (select 1 from public.rescue_units u where u.unit_id = p_unit_id and u.is_active) then
    raise exception 'Choose an active responder unit.';
  end if;
  insert into public.dispatch_tickets(sitio_id, event_id, resident_uid, subject, source, source_ref, priority,
      latitude, longitude, location_note, instructions, equipment, status, assigned_unit_id, created_by, assigned_at)
    values (p_sitio, p_event_id, p_resident_uid, btrim(p_subject), p_source, nullif(btrim(coalesce(p_source_ref, '')), ''), p_priority,
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
revoke all on function public.create_dispatch_ticket(integer, uuid, uuid, text, text, text, text, numeric, numeric, text, text, text[], integer) from public, anon;
grant execute on function public.create_dispatch_ticket(integer, uuid, uuid, text, text, text, text, numeric, numeric, text, text, text[], integer) to authenticated;

-- Assign or reassign. Reassigning a ticket a unit has already acknowledged needs a reason.
create or replace function public.assign_dispatch_ticket(p_ticket_id uuid, p_unit_id integer, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.dispatch_tickets;
begin
  perform public.assert_disaster_admin();
  select * into t from public.dispatch_tickets where ticket_id = p_ticket_id for update;
  if not found then raise exception 'Ticket was not found.'; end if;
  perform public.assert_disaster_admin(t.sitio_id);
  if t.status in ('resolved','cancelled') then raise exception 'Ticket is closed. Refresh the board.'; end if;
  if not exists (select 1 from public.rescue_units u where u.unit_id = p_unit_id and u.is_active) then
    raise exception 'Choose an active responder unit.';
  end if;
  if t.assigned_unit_id = p_unit_id then raise exception 'Ticket is already assigned to this unit.'; end if;
  if t.status in ('acknowledged','en_route','on_scene') and btrim(coalesce(p_note, '')) = '' then
    raise exception 'Give a reason for reassigning a ticket the current unit is already handling.';
  end if;
  update public.dispatch_tickets set assigned_unit_id = p_unit_id, status = 'assigned', assigned_at = clock_timestamp()
    where ticket_id = p_ticket_id;
  insert into public.dispatch_ticket_events(ticket_id, action, from_status, to_status, unit_id, note, actor_uid)
    values (p_ticket_id, case when t.assigned_unit_id is null then 'assigned' else 'reassigned' end,
      t.status, 'assigned', p_unit_id, nullif(btrim(coalesce(p_note, '')), ''), auth.uid());
end;
$$;
revoke all on function public.assign_dispatch_ticket(uuid, integer, text) from public, anon;
grant execute on function public.assign_dispatch_ticket(uuid, integer, text) to authenticated;

-- Progress a ticket. Admins in scope, or an active rescuer who is a member of the assigned unit (app, Module 5.6).
create or replace function public.update_dispatch_status(p_ticket_id uuid, p_status text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.dispatch_tickets; is_member boolean; actor_role text;
  rank_of constant jsonb := '{"open":0,"assigned":1,"acknowledged":2,"en_route":3,"on_scene":4}';
begin
  select * into t from public.dispatch_tickets where ticket_id = p_ticket_id for update;
  if not found then raise exception 'Ticket was not found.'; end if;
  select role::text into actor_role from public.users where uid = auth.uid() and account_status = 'active';
  select exists (select 1 from public.rescue_units u where u.unit_id = t.assigned_unit_id and auth.uid() = any(u.member_uids))
    into is_member;
  if not (actor_role = 'rescuer' and is_member) then perform public.assert_disaster_admin(t.sitio_id); end if;
  if t.status in ('resolved','cancelled') then raise exception 'Ticket is closed. Refresh the board.'; end if;
  if p_status not in ('acknowledged','en_route','on_scene','resolved','cancelled') then raise exception 'Unknown status.'; end if;
  if t.assigned_unit_id is null then raise exception 'Assign a responder unit first.'; end if;
  if p_status = 'cancelled' and actor_role = 'rescuer' then raise exception 'Only an administrator can cancel a ticket.'; end if;
  if p_status in ('acknowledged','en_route','on_scene') and (rank_of->>p_status)::int <= (rank_of->>t.status)::int then
    raise exception 'Status can only move forward (currently %).', t.status;
  end if;
  if p_status in ('resolved','cancelled') and btrim(coalesce(p_note, '')) = '' then
    raise exception 'Describe the outcome before closing the ticket.';
  end if;
  if length(coalesce(p_note, '')) > 1000 then raise exception 'Keep the note under 1,000 characters.'; end if;
  update public.dispatch_tickets set status = p_status,
    closed_at = case when p_status in ('resolved','cancelled') then clock_timestamp() end,
    closed_by = case when p_status in ('resolved','cancelled') then auth.uid() end,
    outcome_note = case when p_status in ('resolved','cancelled') then btrim(p_note) else outcome_note end
    where ticket_id = p_ticket_id;
  insert into public.dispatch_ticket_events(ticket_id, action, from_status, to_status, unit_id, note, actor_uid)
    values (p_ticket_id, case p_status when 'resolved' then 'resolved' when 'cancelled' then 'cancelled' else 'status' end,
      t.status, p_status, t.assigned_unit_id, nullif(btrim(coalesce(p_note, '')), ''), auth.uid());
end;
$$;
revoke all on function public.update_dispatch_status(uuid, text, text) from public, anon;
grant execute on function public.update_dispatch_status(uuid, text, text) to authenticated;

-- Admin closing an unassigned ticket (e.g. duplicate) also goes through here.
create or replace function public.cancel_open_dispatch_ticket(p_ticket_id uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.dispatch_tickets;
begin
  select * into t from public.dispatch_tickets where ticket_id = p_ticket_id for update;
  if not found then raise exception 'Ticket was not found.'; end if;
  perform public.assert_disaster_admin(t.sitio_id);
  if t.status <> 'open' then raise exception 'Only unassigned tickets can be cancelled here.'; end if;
  if btrim(coalesce(p_note, '')) = '' or length(p_note) > 1000 then raise exception 'Give a reason (up to 1,000 characters).'; end if;
  update public.dispatch_tickets set status = 'cancelled', closed_at = clock_timestamp(), closed_by = auth.uid(), outcome_note = btrim(p_note)
    where ticket_id = p_ticket_id;
  insert into public.dispatch_ticket_events(ticket_id, action, from_status, to_status, note, actor_uid)
    values (p_ticket_id, 'cancelled', 'open', 'cancelled', btrim(p_note), auth.uid());
end;
$$;
revoke all on function public.cancel_open_dispatch_ticket(uuid, text) from public, anon;
grant execute on function public.cancel_open_dispatch_ticket(uuid, text) to authenticated;

-- History for one ticket.
create or replace function public.get_dispatch_ticket_history(p_ticket_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.dispatch_tickets;
begin
  select * into t from public.dispatch_tickets where ticket_id = p_ticket_id;
  if not found then raise exception 'Ticket was not found.'; end if;
  perform public.assert_disaster_admin(t.sitio_id);
  return (select coalesce(jsonb_agg(jsonb_build_object('action', e.action, 'from_status', e.from_status, 'to_status', e.to_status,
      'unit_name', (select u.unit_name from public.rescue_units u where u.unit_id = e.unit_id), 'note', e.note,
      'actor_name', (select concat_ws(' ', us.f_name, us.l_name) from public.users us where us.uid = e.actor_uid),
      'recorded_at', e.recorded_at) order by e.event_no), '[]'::jsonb)
    from public.dispatch_ticket_events e where e.ticket_id = p_ticket_id);
end;
$$;
revoke all on function public.get_dispatch_ticket_history(uuid) from public, anon;
grant execute on function public.get_dispatch_ticket_history(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
