-- Step 6: evacuation centres belong to a barangay.
-- A barangay admin sees their barangay's centres plus any centre their barangay's shelter plan uses
-- (view only), and can only change their own. Super admins see and change all. A centre with no
-- barangay is municipal-wide: super admins manage it, and barangay admins see it only if their plan uses it.
begin;

alter table public.evacuation_centers
  add column if not exists barangay_id integer references public.barangays(barangay_id);
create index if not exists evacuation_centers_barangay_idx on public.evacuation_centers(barangay_id);

-- Test sites (all moved into Cordova on 2026-10-19).
update public.evacuation_centers c set barangay_id = b.barangay_id
  from public.barangays b
  where c.barangay_id is null and (c.center_id, b.barangay_name) in
    ((1, 'Poblacion'), (2, 'Day-as'), (9001, 'Gabi'), (9002, 'Buagsong'), (9003, 'Alegria'));

-- The mock Buagsong plan pointed at centre 9001, which is now the Gabi Evacuation Center.
update public.barangay_shelter_plans set primary_center_id = 9002, alternate_center_ids = array[2],
    note = 'Mock: covered court first, Day-as school if full', updated_at = now()
  where barangay_id = 3 and primary_center_id = 9001;

create or replace function public.facility_actor()
returns table(is_super boolean, barangay_id integer)
language sql stable security definer set search_path = '' as $$
  select u.role::text = 'super_admin', u.assigned_barangay_id
  from public.users u where u.uid = auth.uid() and u.account_status = 'active'
$$;
revoke all on function public.facility_actor() from public, anon, authenticated;

create or replace function public.facility_visible(p_center_id integer)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.facility_actor() a
    join public.evacuation_centers c on c.center_id = p_center_id
    where a.is_super
      or c.barangay_id = a.barangay_id
      or exists(select 1 from public.barangay_shelter_plans p where p.barangay_id = a.barangay_id
        and (p.primary_center_id = c.center_id or c.center_id = any(p.alternate_center_ids))))
$$;
revoke all on function public.facility_visible(integer) from public, anon, authenticated;

create or replace function public.facility_editable(p_center_id integer)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.facility_actor() a
    join public.evacuation_centers c on c.center_id = p_center_id
    where a.is_super or (a.barangay_id is not null and c.barangay_id = a.barangay_id))
$$;
revoke all on function public.facility_editable(integer) from public, anon, authenticated;

create or replace function public.assert_facility_editable(p_center_id integer)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.facility_editable(p_center_id) then
    raise exception 'Only this facility''s barangay admin or a municipal admin can change it.' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.assert_facility_editable(integer) from public, anon, authenticated;

-- Distinct households currently checked in: a resident's or member's household, and each walk-in group as one.
create or replace function public.recorded_facility_households(p_center_id integer)
returns integer language sql stable security definer set search_path = '' as $$
  select count(distinct coalesce(h.household_id::text, hm.household_id::text, 'walk-in:' || latest.record_id::text))::integer
  from (
    select distinct on (coalesce(resident_uid, member_id, record_id)) record_id, resident_uid, member_id, evac_center_id, evac_status
    from public.evacuation_records
    order by coalesce(resident_uid, member_id, record_id), logged_at desc nulls last, record_id desc
  ) latest
  left join public.households h on h.head_uid = latest.resident_uid
  left join public.household_members hm on hm.member_id = latest.member_id
  where latest.evac_center_id = p_center_id and latest.evac_status::text = 'safely_evacuated';
$$;
revoke all on function public.recorded_facility_households(integer) from public, anon, authenticated;

create or replace function public.get_evacuation_facility_catalog()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  perform public.assert_facility_admin();
  select coalesce(jsonb_agg(jsonb_build_object('center_id',c.center_id,'capacity',c.capacity,
    'occupied',public.recorded_facility_occupancy(c.center_id),
    'households',public.recorded_facility_households(c.center_id),'status',c.status,
    'closed_at',c.closed_at,'closure_reason',c.closure_reason,
    'barangay_id',c.barangay_id,'barangay_name',b.barangay_name,
    'editable',public.facility_editable(c.center_id)) order by c.center_name),'[]'::jsonb)
    into result from public.evacuation_centers c left join public.barangays b on b.barangay_id = c.barangay_id
    where public.facility_visible(c.center_id);
  return result;
end;
$$;

create or replace function public.register_evacuation_facility(
  p_name text, p_type text, p_lat numeric, p_long numeric, p_capacity integer, p_barangay_id integer
)
returns integer language plpgsql security definer set search_path = '' as $$
declare new_id integer; actor_super boolean; actor_barangay integer; target_barangay integer;
begin
  perform public.assert_facility_admin();
  select is_super, barangay_id into actor_super, actor_barangay from public.facility_actor();
  if actor_super then
    target_barangay := p_barangay_id; -- null = municipal-wide
  elsif actor_barangay is null then
    raise exception 'Your account has no assigned barangay.' using errcode = '42501';
  elsif p_barangay_id is not null and p_barangay_id <> actor_barangay then
    raise exception 'You can only register facilities in your own barangay.' using errcode = '42501';
  else
    target_barangay := actor_barangay;
  end if;
  if target_barangay is not null and not exists(select 1 from public.barangays where barangay_id = target_barangay) then
    raise exception 'Unknown barangay.';
  end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 100 then
    raise exception 'Facility name must be 1–100 characters.';
  end if;
  if p_type is null or p_type not in ('school','covered_court','barangay_hall','church','makeshift','other') then
    raise exception 'Invalid facility type.';
  end if;
  if p_lat is null or p_long is null or not (p_lat between -90 and 90) or not (p_long between -180 and 180) then
    raise exception 'Invalid GPS coordinates.';
  end if;
  if p_capacity is null or p_capacity not between 1 and 1000000 then
    raise exception 'Capacity must be 1–1,000,000 people.';
  end if;
  perform pg_advisory_xact_lock(hashtext('facility-registration:' || lower(btrim(p_name))));
  if exists(select 1 from public.evacuation_centers where lower(btrim(center_name)) = lower(btrim(p_name))
    and gps_lat = p_lat and gps_long = p_long) then
    raise exception 'A facility with this name and location is already registered.';
  end if;
  insert into public.evacuation_centers(center_name, center_type, gps_lat, gps_long, capacity, barangay_id, created_by, updated_at)
    values(btrim(p_name), p_type::public.center_type, p_lat, p_long, p_capacity, target_barangay, auth.uid(), clock_timestamp())
    returning center_id into new_id;
  insert into public.facility_capacity_audit(center_id, old_capacity, new_capacity, changed_by)
    values(new_id, null, p_capacity, auth.uid());
  return new_id;
end;
$$;
revoke all on function public.register_evacuation_facility(text,text,numeric,numeric,integer,integer) from public, anon;
grant execute on function public.register_evacuation_facility(text,text,numeric,numeric,integer,integer) to authenticated;

-- The old 5-argument form stays for older web builds: it registers in the admin's own barangay.
create or replace function public.register_evacuation_facility(
  p_name text, p_type text, p_lat numeric, p_long numeric, p_capacity integer
)
returns integer language sql security definer set search_path = '' as $$
  select public.register_evacuation_facility(p_name, p_type, p_lat, p_long, p_capacity, null::integer)
$$;

create or replace function public.set_evacuation_facility_capacity(p_center_id integer, p_capacity integer, p_expected_capacity integer)
returns void language plpgsql security definer set search_path = '' as $$
declare old_capacity integer; occupied integer;
begin
  perform public.assert_facility_admin();
  perform public.assert_facility_editable(p_center_id);
  if p_capacity is null or p_capacity not between 1 and 1000000 then
    raise exception 'Capacity must be 1–1,000,000 people.';
  end if;
  select capacity into old_capacity from public.evacuation_centers where center_id = p_center_id for update;
  if not found then raise exception 'Facility not found.'; end if;
  if old_capacity is distinct from p_expected_capacity then
    raise exception 'Capacity was changed by another administrator. Refresh before saving.';
  end if;
  -- Keep the occupancy snapshot stable while validating this capacity change.
  lock table public.evacuation_records in share mode;
  occupied := public.recorded_facility_occupancy(p_center_id);
  if p_capacity < occupied then
    raise exception 'Capacity cannot be below the current recorded occupancy (%)', occupied;
  end if;
  if old_capacity is distinct from p_capacity then
    update public.evacuation_centers set capacity = p_capacity, updated_at = clock_timestamp() where center_id = p_center_id;
    insert into public.facility_capacity_audit(center_id, old_capacity, new_capacity, changed_by)
      values(p_center_id, old_capacity, p_capacity, auth.uid());
  end if;
end;
$$;

create or replace function public.change_evacuation_facility_status(p_center_id integer, p_status text, p_reason text, p_expected_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare old_status text; current_capacity integer; blocked integer;
begin
  perform public.assert_facility_admin();
  perform public.assert_facility_editable(p_center_id);
  if p_status is null or p_status not in ('active','closed') then raise exception 'Invalid facility status.'; end if;
  if p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then raise exception 'A reason of 1–1,000 characters is required.'; end if;
  -- Wait for current admissions, and block new ones until the transition commits.
  lock table public.evacuation_records in share mode;
  select status,capacity into old_status,current_capacity from public.evacuation_centers where center_id=p_center_id for update;
  if not found then raise exception 'Facility not found.'; end if;
  if old_status is distinct from p_expected_status then raise exception 'Facility status changed. Refresh before trying again.'; end if;
  if old_status = p_status then raise exception 'Facility already has this status.'; end if;
  if p_status = 'closed' then
    select count(*)::integer into blocked from (
      select distinct on (coalesce(resident_uid, member_id, record_id)) resident_uid,evac_center_id,evac_status
      from public.evacuation_records order by coalesce(resident_uid, member_id, record_id),logged_at desc nulls last,record_id desc
    ) latest where evac_center_id=p_center_id and evac_status::text in ('pending','in_transit','safely_evacuated');
    if blocked > 0 then raise exception 'Cannot close: % resident(s) have occupied, pending, or in-transit records. Resolve or transfer them first.',blocked; end if;
  elsif current_capacity is null or current_capacity < 1 then
    raise exception 'Set a reviewed safe capacity before reopening.';
  end if;
  update public.evacuation_centers set status=p_status, updated_at=clock_timestamp(),
    closed_at=case when p_status='closed' then clock_timestamp() else null end,
    closed_by=case when p_status='closed' then auth.uid() else null end,
    closure_reason=case when p_status='closed' then btrim(p_reason) else null end
    where center_id=p_center_id;
  insert into public.facility_status_audit(center_id,old_status,new_status,reason,changed_by)
    values(p_center_id,old_status,p_status,btrim(p_reason),auth.uid());
end;
$$;

commit;
