-- Step 5: "Temporary Shelter" facility type (stored as 'makeshift') and the real Gabi site name.
-- ALTER TYPE ... ADD VALUE must commit before the value is used, so it runs on its own first.
alter type public.center_type add value if not exists 'makeshift' before 'other';

begin;
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

-- The DSWD report on the March 2024 Gabi fire names the "Gabi Evacuation Center".
update public.evacuation_centers set center_name = 'Gabi Evacuation Center', center_type = 'other'
  where center_id = 9001 and center_name = 'Gabi Elementary School (test site)';
commit;
