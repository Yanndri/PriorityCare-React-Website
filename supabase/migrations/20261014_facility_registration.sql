-- Adds registration and administrator-entered safe capacities.
-- Existing centers keep NULL capacity until reviewed; no arbitrary defaults.
begin;
alter table public.evacuation_centers
  add column if not exists capacity integer check (capacity between 1 and 1000000),
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists updated_at timestamptz;

create table if not exists public.facility_capacity_audit (
  audit_id bigint generated always as identity primary key,
  center_id integer not null references public.evacuation_centers(center_id) on delete cascade,
  old_capacity integer,
  new_capacity integer not null,
  changed_by uuid not null references auth.users(id),
  changed_at timestamptz not null default now()
);
alter table public.facility_capacity_audit enable row level security;
revoke all on public.facility_capacity_audit from anon, authenticated;

create or replace function public.assert_facility_admin()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.users where uid = auth.uid()
    and account_status = 'active' and role::text in ('admin','super_admin')) then
    raise exception 'Active administrator access is required.' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.assert_facility_admin() from public, anon, authenticated;

create or replace function public.recorded_facility_occupancy(p_center_id integer)
returns integer language sql security definer set search_path = '' as $$
  select count(*)::integer from (
    select distinct on (resident_uid) resident_uid, evac_center_id, evac_status
    from public.evacuation_records
    order by resident_uid, logged_at desc nulls last, record_id desc
  ) latest where evac_center_id = p_center_id and evac_status::text = 'safely_evacuated';
$$;
revoke all on function public.recorded_facility_occupancy(integer) from public, anon, authenticated;

create or replace function public.get_evacuation_facility_catalog()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  perform public.assert_facility_admin();
  select coalesce(jsonb_agg(jsonb_build_object('center_id', center_id,
    'capacity', capacity, 'occupied', public.recorded_facility_occupancy(center_id)) order by center_name), '[]'::jsonb)
    into result from public.evacuation_centers;
  return result;
end;
$$;
revoke all on function public.get_evacuation_facility_catalog() from public, anon;
grant execute on function public.get_evacuation_facility_catalog() to authenticated;

create or replace function public.register_evacuation_facility(
  p_name text, p_type text, p_lat numeric, p_long numeric, p_capacity integer
)
returns integer language plpgsql security definer set search_path = '' as $$
declare new_id integer;
begin
  perform public.assert_facility_admin();
  if p_name is null or length(btrim(p_name)) not between 1 and 100 then
    raise exception 'Facility name must be 1–100 characters.';
  end if;
  if p_type is null or p_type not in ('school','covered_court','barangay_hall','church','other') then
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
  insert into public.evacuation_centers(center_name, center_type, gps_lat, gps_long, capacity, created_by, updated_at)
    values(btrim(p_name), p_type::public.center_type, p_lat, p_long, p_capacity, auth.uid(), clock_timestamp())
    returning center_id into new_id;
  insert into public.facility_capacity_audit(center_id, old_capacity, new_capacity, changed_by)
    values(new_id, null, p_capacity, auth.uid());
  return new_id;
end;
$$;
revoke all on function public.register_evacuation_facility(text,text,numeric,numeric,integer) from public, anon;
grant execute on function public.register_evacuation_facility(text,text,numeric,numeric,integer) to authenticated;

create or replace function public.set_evacuation_facility_capacity(
  p_center_id integer, p_capacity integer, p_expected_capacity integer
)
returns void language plpgsql security definer set search_path = '' as $$
declare old_capacity integer; occupied integer;
begin
  perform public.assert_facility_admin();
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
revoke all on function public.set_evacuation_facility_capacity(integer,integer,integer) from public, anon;
grant execute on function public.set_evacuation_facility_capacity(integer,integer,integer) to authenticated;
notify pgrst, 'reload schema';
commit;
