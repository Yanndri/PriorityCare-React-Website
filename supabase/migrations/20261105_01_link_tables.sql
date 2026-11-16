-- STEP 18 (2026-11-05): normalization (1NF). Two columns stored a LIST of ids in one cell,
-- which the database could not check (no foreign key):
--   barangay_shelter_plans.alternate_center_ids  ->  new table shelter_plan_alternates
--   rescue_units.member_uids                     ->  new table rescue_unit_members
-- Each list item becomes one row with real foreign keys. Existing data is copied over first.
-- The functions the web and app call keep the same inputs and outputs, so no app/web code changes.

-- 1. The two link tables (only reached through the functions below, like their parent tables).
create table if not exists public.shelter_plan_alternates (
  barangay_id integer not null references public.barangay_shelter_plans(barangay_id) on delete cascade,
  center_id integer not null references public.evacuation_centers(center_id),
  position smallint not null default 1, -- order the admin chose (1 = first backup)
  primary key (barangay_id, center_id)
);
create table if not exists public.rescue_unit_members (
  unit_id integer not null references public.rescue_units(unit_id) on delete cascade,
  uid uuid not null references public.users(uid),
  primary key (unit_id, uid)
);
create index if not exists rescue_unit_members_uid on public.rescue_unit_members(uid);
alter table public.shelter_plan_alternates enable row level security;
alter table public.rescue_unit_members enable row level security;
revoke all on public.shelter_plan_alternates, public.rescue_unit_members from anon, authenticated;

-- 2. Copy the existing lists into rows.
insert into public.shelter_plan_alternates (barangay_id, center_id, position)
select p.barangay_id, a.center_id, a.pos from public.barangay_shelter_plans p,
  unnest(p.alternate_center_ids) with ordinality as a(center_id, pos)
on conflict do nothing;
insert into public.rescue_unit_members (unit_id, uid)
select u.unit_id, m from public.rescue_units u, unnest(u.member_uids) m
on conflict do nothing;

-- 3. Small helpers that rebuild the old lists, so function outputs stay the same.
create or replace function public.plan_alternates(p_barangay integer)
returns integer[] language sql stable security definer set search_path to '' as $$
  select coalesce(array_agg(a.center_id order by a.position, a.center_id), '{}')
  from public.shelter_plan_alternates a where a.barangay_id = p_barangay
$$;
create or replace function public.unit_members(p_unit integer)
returns uuid[] language sql stable security definer set search_path to '' as $$
  select coalesce(array_agg(m.uid order by m.uid), '{}') from public.rescue_unit_members m where m.unit_id = p_unit
$$;
revoke all on function public.plan_alternates(integer), public.unit_members(integer) from public, anon, authenticated;

-- 4. Only accredited rescuers can be ADDED to a unit (same rule as before, now on the link table).
create or replace function public.check_unit_member_accreditation()
returns trigger language plpgsql security definer set search_path to '' as $function$
begin
  if not public.responder_is_deployable(new.uid) then
    raise exception 'Not deployable: % (needs an active rescuer account with current CDV accreditation).',
      coalesce((select nullif(concat_ws(' ', u.f_name, u.l_name), '') from public.users u where u.uid = new.uid), new.uid::text);
  end if;
  return new;
end;
$function$;
drop trigger if exists rescue_unit_members_accredited on public.rescue_units;
drop trigger if exists rescue_unit_members_accredited on public.rescue_unit_members;
create trigger rescue_unit_members_accredited before insert on public.rescue_unit_members
  for each row execute function public.check_unit_member_accreditation();

-- 5. Functions that read or write the lists.
create or replace function public.facility_visible(p_center_id integer)
returns boolean language sql stable security definer set search_path to '' as $function$
  select exists(
    select 1 from public.facility_actor() a
    join public.evacuation_centers c on c.center_id = p_center_id
    where a.is_super
      or c.barangay_id = a.barangay_id
      or exists(select 1 from public.barangay_shelter_plans p where p.barangay_id = a.barangay_id and p.primary_center_id = c.center_id)
      or exists(select 1 from public.shelter_plan_alternates s where s.barangay_id = a.barangay_id and s.center_id = c.center_id))
$function$;

create or replace function public.set_barangay_shelters(p_barangay integer, p_primary integer, p_alternates integer[], p_note text)
returns void language plpgsql security definer set search_path to '' as $function$
declare old_plan public.barangay_shelter_plans; new_plan public.barangay_shelter_plans;
  alts integer[] := coalesce(p_alternates, '{}'); old_alts integer[];
begin
  perform public.assert_disaster_admin(p_barangay);
  if p_barangay is null or not exists (select 1 from public.barangays where barangay_id = p_barangay) then
    raise exception 'Select a valid barangay.';
  end if;
  if p_primary is null and cardinality(alts) > 0 then
    raise exception 'Choose a primary shelter before adding alternates.';
  end if;
  if cardinality(alts) > 3 then raise exception 'Choose at most 3 alternate shelters.'; end if;
  if (select count(distinct a) from unnest(alts) a) <> cardinality(alts) or p_primary = any(alts) then
    raise exception 'Each shelter can appear only once in a barangay plan.';
  end if;
  if exists (select 1 from unnest(array_append(alts, p_primary)) a
             where a is not null and not exists (select 1 from public.evacuation_centers c where c.center_id = a)) then
    raise exception 'One of the selected shelters does not exist.';
  end if;
  if p_primary is not null and exists (select 1 from public.evacuation_centers c where c.center_id = p_primary and c.status = 'closed') then
    raise exception 'A closed evacuation center cannot be a primary shelter. Reopen it or choose another.';
  end if;
  if length(coalesce(p_note, '')) > 500 then raise exception 'Keep the note under 500 characters.'; end if;

  select * into old_plan from public.barangay_shelter_plans where barangay_id = p_barangay for update;
  old_alts := public.plan_alternates(p_barangay);
  -- Barangay admins: own-barangay or municipal-wide centres, plus any the municipal admin already put in this plan.
  if not coalesce((select is_super from public.facility_actor()), false) and exists (
      select 1 from unnest(array_append(alts, p_primary)) a
      join public.evacuation_centers c on c.center_id = a
      where c.barangay_id is not null and c.barangay_id <> p_barangay
        and not (a = old_plan.primary_center_id or a = any(old_alts)))
  then
    raise exception 'Choose a shelter in your barangay. Only the municipal admin can assign another barangay''s shelter.' using errcode = '42501';
  end if;
  insert into public.barangay_shelter_plans as p (barangay_id, primary_center_id, note, updated_at, updated_by)
    values (p_barangay, p_primary, btrim(coalesce(p_note, '')), clock_timestamp(), auth.uid())
    on conflict (barangay_id) do update set primary_center_id = excluded.primary_center_id, note = excluded.note,
      updated_at = excluded.updated_at, updated_by = excluded.updated_by
    returning * into new_plan;
  delete from public.shelter_plan_alternates where barangay_id = p_barangay;
  insert into public.shelter_plan_alternates (barangay_id, center_id, position)
    select p_barangay, a, pos from unnest(alts) with ordinality as x(a, pos);
  insert into public.barangay_shelter_plan_audit(barangay_id, previous, current, actor_uid)
    values (p_barangay,
      case when old_plan.barangay_id is null then null else to_jsonb(old_plan) || jsonb_build_object('alternate_center_ids', to_jsonb(old_alts)) end,
      to_jsonb(new_plan) || jsonb_build_object('alternate_center_ids', to_jsonb(alts)), auth.uid());
end;
$function$;

create or replace function public.get_my_preemptive_evacuation()
returns jsonb language plpgsql stable security definer set search_path to '' as $function$
declare r public.residents; v_household uuid; v_latest public.preemptive_evacuation_logs; v_plan public.barangay_shelter_plans; v_alts integer[];
begin
  select * into r from public.residents where uid = auth.uid();
  if not found then raise exception 'Only registered residents can report evacuation status.'; end if;
  v_household := public.resident_household_id(auth.uid());
  select * into v_latest from public.preemptive_evacuation_logs l
    where l.resident_uid = auth.uid() order by l.logged_at desc, l.log_id desc limit 1;
  select * into v_plan from public.barangay_shelter_plans p where p.barangay_id = r.barangay_id;
  v_alts := public.plan_alternates(r.barangay_id);
  return jsonb_build_object(
    'latest', public.preemptive_log_json(v_latest),
    'household_size', 1 + (select count(*) from public.household_members m where m.household_id = v_household),
    'members', coalesce((select jsonb_agg(jsonb_build_object('member_id', m.member_id, 'full_name', m.full_name) order by m.full_name)
                         from public.household_members m where m.household_id = v_household), '[]'::jsonb),
    'active_event', (select jsonb_build_object('event_id', e.event_id, 'name', e.name, 'hazard_type', e.hazard_type)
                     from public.disaster_events e where e.barangay_id = r.barangay_id and e.status = 'active'
                     order by e.started_at desc limit 1),
    'centers', coalesce((select jsonb_agg(jsonb_build_object(
        'center_id', c.center_id, 'center_name', c.center_name, 'gps_lat', c.gps_lat, 'gps_long', c.gps_long,
        'capacity', c.capacity, 'assigned', c.center_id = v_plan.primary_center_id or c.center_id = any(v_alts),
        'is_primary', c.center_id = v_plan.primary_center_id)
        order by (c.center_id = v_plan.primary_center_id) desc nulls last,
                 (c.center_id = any(v_alts)) desc nulls last, c.center_name)
      from public.evacuation_centers c where coalesce(c.status, 'open') <> 'closed'), '[]'::jsonb));
end;
$function$;

create or replace function public.get_shelter_assignments()
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare actor_role text; actor_barangay integer; is_super boolean;
begin
  perform public.assert_disaster_admin();
  select role::text, assigned_barangay_id into actor_role, actor_barangay from public.users where uid = auth.uid();
  is_super := actor_role = 'super_admin';
  return jsonb_build_object(
    'generated_at', clock_timestamp(),
    'can_edit_all', is_super,
    'barangays', (select coalesce(jsonb_agg(jsonb_build_object(
        'barangay_id', s.barangay_id, 'barangay_name', s.barangay_name,
        'editable', is_super or s.barangay_id = actor_barangay,
        'residents', (select count(*) from public.residents r where r.barangay_id = s.barangay_id),
        'dependents', (select count(*) from public.household_members hm join public.households h on h.household_id = hm.household_id where h.barangay_id = s.barangay_id),
        'centroid_lat', (select avg(r.gps_lat) from public.residents r where r.barangay_id = s.barangay_id
            and r.gps_lat between -90 and 90 and r.gps_long between -180 and 180 and not (r.gps_lat = 0 and r.gps_long = 0)),
        'centroid_long', (select avg(r.gps_long) from public.residents r where r.barangay_id = s.barangay_id
            and r.gps_lat between -90 and 90 and r.gps_long between -180 and 180 and not (r.gps_lat = 0 and r.gps_long = 0)),
        'primary_center_id', p.primary_center_id,
        'alternate_center_ids', to_jsonb(public.plan_alternates(s.barangay_id)),
        'note', coalesce(p.note, ''),
        'updated_at', p.updated_at,
        'updated_by_name', (select concat_ws(' ', u.f_name, u.l_name) from public.users u where u.uid = p.updated_by)
      ) order by s.barangay_name), '[]'::jsonb)
      from public.barangays s left join public.barangay_shelter_plans p on p.barangay_id = s.barangay_id
      where is_super or s.barangay_id = actor_barangay),
    -- Planned population still counts every barangay's primary assignment, so a shared shelter's load is right.
    'centers', (select coalesce(jsonb_agg(jsonb_build_object(
        'center_id', c.center_id, 'center_name', c.center_name, 'status', c.status, 'capacity', c.capacity,
        'gps_lat', c.gps_lat, 'gps_long', c.gps_long, 'barangay_id', c.barangay_id,
        'primary_for', (select coalesce(jsonb_agg(p.barangay_id order by p.barangay_id), '[]'::jsonb)
          from public.barangay_shelter_plans p where p.primary_center_id = c.center_id
            and (is_super or p.barangay_id = actor_barangay)),
        'other_barangays_planned', (select count(*) from public.barangay_shelter_plans p
          where p.primary_center_id = c.center_id and not is_super and p.barangay_id is distinct from actor_barangay),
        'planned_population', (select coalesce(sum(
            (select count(*) from public.residents r where r.barangay_id = p.barangay_id)
            + (select count(*) from public.household_members hm join public.households h on h.household_id = hm.household_id where h.barangay_id = p.barangay_id)), 0)
          from public.barangay_shelter_plans p where p.primary_center_id = c.center_id)
      ) order by c.center_name), '[]'::jsonb) from public.evacuation_centers c
      where is_super or c.barangay_id = actor_barangay or c.barangay_id is null or public.facility_visible(c.center_id))
  );
end;
$function$;

create or replace function public.save_rescue_unit(p_unit_id integer, p_name text, p_barangay integer, p_capabilities text[], p_member_uids uuid[], p_active boolean)
returns integer language plpgsql security definer set search_path to '' as $function$
declare actor_role text; existing public.rescue_units; result_id integer;
  caps text[] := array(select distinct btrim(c) from unnest(coalesce(p_capabilities, '{}')) c where btrim(c) <> '');
  members uuid[] := array(select distinct m from unnest(coalesce(p_member_uids, '{}')) m where m is not null);
begin
  perform public.assert_disaster_admin();
  select role::text into actor_role from public.users where uid = auth.uid();
  if p_unit_id is not null then
    select * into existing from public.rescue_units where unit_id = p_unit_id for update;
    if not found then raise exception 'Unit was not found.'; end if;
    if existing.barangay_id is null and actor_role <> 'super_admin' then
      raise exception 'Only a super admin can edit barangay-wide units.' using errcode = '42501';
    end if;
    if existing.barangay_id is not null then perform public.assert_disaster_admin(existing.barangay_id); end if;
  end if;
  if p_barangay is null and actor_role <> 'super_admin' then
    raise exception 'Only a super admin can create barangay-wide units. Choose your barangay.' using errcode = '42501';
  end if;
  if p_barangay is not null then perform public.assert_disaster_admin(p_barangay); end if;
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
    insert into public.rescue_units(unit_name, barangay_id, capabilities, is_active, updated_by)
      values (btrim(p_name), p_barangay, caps, coalesce(p_active, true), auth.uid()) returning unit_id into result_id;
  else
    update public.rescue_units set unit_name = btrim(p_name), barangay_id = p_barangay, capabilities = caps,
      is_active = coalesce(p_active, true), updated_at = clock_timestamp(), updated_by = auth.uid()
      where unit_id = p_unit_id returning unit_id into result_id;
  end if;
  -- Members: remove the ones taken off, add the new ones (only new ones are checked for accreditation).
  delete from public.rescue_unit_members where unit_id = result_id and not (uid = any(members));
  insert into public.rescue_unit_members (unit_id, uid) select result_id, m from unnest(members) m on conflict do nothing;
  return result_id;
exception when unique_violation then
  raise exception 'A unit with this name already exists.';
end;
$function$;

create or replace function public.list_responders()
returns jsonb language plpgsql stable security definer set search_path to '' as $function$
declare actor_super boolean; actor_barangay integer;
begin
  perform public.assert_facility_admin();
  select is_super, barangay_id into actor_super, actor_barangay from public.facility_actor();
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'uid', u.uid, 'name', concat_ws(' ', u.f_name, u.m_name, u.l_name), 'f_name', u.f_name, 'm_name', u.m_name,
      'l_name', u.l_name, 'email', u.email, 'contact_no', u.contact_no, 'account_status', u.account_status,
      'barangay_id', u.assigned_barangay_id, 'barangay_name', b.barangay_name,
      'accreditation_no', a.accreditation_no, 'organization', a.organization,
      'accredited_on', a.accredited_on, 'valid_until', a.valid_until,
      'trainings', coalesce(to_jsonb(a.trainings), '[]'::jsonb), 'insurance_ref', a.insurance_ref,
      'deployable', public.responder_is_deployable(u.uid),
      'units', (select coalesce(jsonb_agg(un.unit_name order by un.unit_name), '[]'::jsonb)
                from public.rescue_units un join public.rescue_unit_members rm on rm.unit_id = un.unit_id where rm.uid = u.uid)
    ) order by u.l_name, u.f_name), '[]'::jsonb)
    from public.users u
    left join public.barangays b on b.barangay_id = u.assigned_barangay_id
    left join public.responder_accreditations a on a.uid = u.uid
    where u.role::text = 'rescuer'
      and (actor_super or u.assigned_barangay_id = actor_barangay
           or exists(select 1 from public.rescue_units un join public.rescue_unit_members rm on rm.unit_id = un.unit_id
                     where un.barangay_id = actor_barangay and rm.uid = u.uid)));
end;
$function$;

create or replace function public.update_dispatch_status(p_ticket_id uuid, p_status text, p_note text)
returns void language plpgsql security definer set search_path to '' as $function$
declare t public.dispatch_tickets; is_member boolean; actor_role text;
  rank_of constant jsonb := '{"open":0,"assigned":1,"acknowledged":2,"en_route":3,"on_scene":4}';
begin
  select * into t from public.dispatch_tickets where ticket_id = p_ticket_id for update;
  if not found then raise exception 'Ticket was not found.'; end if;
  select role::text into actor_role from public.users where uid = auth.uid() and account_status = 'active';
  select exists (select 1 from public.rescue_unit_members m where m.unit_id = t.assigned_unit_id and m.uid = auth.uid())
    into is_member;
  if not (actor_role = 'rescuer' and is_member) then perform public.assert_disaster_admin(t.barangay_id); end if;
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
$function$;

-- Rescuers can read tickets assigned to a unit they are in.
-- (Helper runs with owner rights: signed-in users cannot read the link table directly.)
create or replace function public.is_unit_member(p_unit integer)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (select 1 from public.rescue_unit_members m where m.unit_id = p_unit and m.uid = auth.uid())
$$;
revoke all on function public.is_unit_member(integer) from public, anon;
grant execute on function public.is_unit_member(integer) to authenticated;
alter policy dispatch_tickets_read on public.dispatch_tickets using (
  public.staff_can_access_barangay(barangay_id) or public.is_unit_member(assigned_unit_id));

create or replace function public.get_dispatch_board()
returns jsonb language plpgsql security definer set search_path to '' as $function$
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
        'capabilities', to_jsonb(un.capabilities), 'member_uids', to_jsonb(public.unit_members(un.unit_id)), 'is_active', un.is_active,
        'editable', actor_role = 'super_admin' or (un.barangay_id is not null and un.barangay_id = actor_barangay),
        'members', (select coalesce(jsonb_agg(jsonb_build_object('uid', u.uid, 'name', concat_ws(' ', u.f_name, u.l_name), 'contact_no', u.contact_no)
            order by u.l_name), '[]'::jsonb) from public.rescue_unit_members rm join public.users u on u.uid = rm.uid where rm.unit_id = un.unit_id),
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
$function$;

create or replace function public.get_rescuer_feed()
returns jsonb language plpgsql stable security definer set search_path to '' as $function$
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
$function$;

-- 6. Remove the old list columns (their data now lives in the link tables).
alter table public.barangay_shelter_plans drop column if exists alternate_center_ids;
alter table public.rescue_units drop column if exists member_uids;

-- 7. Check: nothing in the database still uses the old columns (stops the whole step if something does).
do $$
declare n integer;
begin
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
  where s.nspname = 'public' and (p.prosrc like '%alternate_center_ids%' and p.proname not in ('get_shelter_assignments', 'set_barangay_shelters')
                                  or p.prosrc like '%member_uids%' and p.proname not in ('save_rescue_unit', 'get_dispatch_board'));
  if n > 0 then raise exception 'STEP18 stopped: % function(s) still use the old columns. Nothing was changed.', n; end if;
end $$;
