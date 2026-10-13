-- Review before applying in Supabase SQL Editor. No existing profiles are rewritten.
-- Registered accounts share a household; dependents without accounts are stored once.
begin;

create table if not exists public.households (
  household_id uuid primary key default gen_random_uuid(),
  household_name text not null check (length(btrim(household_name)) between 1 and 200),
  sitio_id integer not null references public.sitios(sitio_id),
  head_uid uuid not null unique references public.residents(uid),
  household_members jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  constraint household_members_array check (
    jsonb_typeof(household_members) = 'array' and jsonb_array_length(household_members) <= 30
  )
);
alter table public.households enable row level security;
revoke all on public.households from anon, authenticated;
grant select on public.households to authenticated;
drop policy if exists "Administrators read assigned households" on public.households;
create policy "Administrators read assigned households" on public.households for select to authenticated
using (exists (select 1 from public.users actor where actor.uid = auth.uid()
  and actor.account_status = 'active' and (actor.role::text = 'super_admin'
    or (actor.role::text = 'admin' and actor.assigned_sitio_id = households.sitio_id))));

create table if not exists public.resident_profile_details (
  resident_uid uuid primary key references public.residents(uid) on delete cascade,
  address text not null default '',
  landmark text not null default '',
  is_pregnant boolean not null default false,
  vulnerability_needs text not null default '',
  household_id uuid references public.households(household_id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
alter table public.resident_profile_details enable row level security;
-- Access goes through the guarded functions below, not direct table writes.
revoke all on public.resident_profile_details from anon, authenticated;
grant select on public.resident_profile_details to authenticated;
drop policy if exists "Administrators read assigned resident details" on public.resident_profile_details;
create policy "Administrators read assigned resident details" on public.resident_profile_details
for select to authenticated using (exists (
  select 1 from public.users actor join public.residents r on r.uid = resident_uid
  where actor.uid = auth.uid() and actor.account_status = 'active'
    and (actor.role::text = 'super_admin' or
      (actor.role::text = 'admin' and actor.assigned_sitio_id = r.sitio_id))
));

create or replace function public.assert_resident_edit_access(p_uid uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.users actor
    join public.residents resident on resident.uid = p_uid
    join public.users subject on subject.uid = resident.uid
    where actor.uid = auth.uid() and actor.account_status = 'active'
      and subject.role::text = 'resident'
      and (
        actor.role::text = 'super_admin'
        or (actor.role::text = 'admin' and actor.assigned_sitio_id = resident.sitio_id)
      )
  ) then
    raise exception 'Active administrator access to this resident is required.' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.assert_resident_edit_access(uuid) from public, anon, authenticated;

create or replace function public.get_resident_edit_profile(p_uid uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  perform public.assert_resident_edit_access(p_uid);
  select jsonb_build_object(
    'sitio_name', s.sitio_name,
    'households', (select coalesce(jsonb_agg(jsonb_build_object(
      'household_id', hh.household_id, 'household_name', hh.household_name,
      'head_name', concat_ws(' ', hu.f_name, hu.m_name, hu.l_name)
    ) order by hh.household_name), '[]'::jsonb) from public.households hh
      join public.users hu on hu.uid = hh.head_uid where hh.sitio_id = r.sitio_id),
    'registered_members', (select coalesce(jsonb_agg(jsonb_build_object(
      'uid', mu.uid, 'name', concat_ws(' ', mu.f_name, mu.m_name, mu.l_name),
      'is_head', mu.uid = h.head_uid
    ) order by mu.f_name), '[]'::jsonb) from public.resident_profile_details md
      join public.users mu on mu.uid = md.resident_uid where md.household_id = h.household_id),
    'disability_types', (select coalesce(jsonb_agg(jsonb_build_object(
      'disability_id', t.disability_id, 'disability_name', t.disability_name
    ) order by t.disability_name), '[]'::jsonb) from public.disability_types t),
    'profile', jsonb_build_object(
      'f_name', u.f_name, 'm_name', coalesce(u.m_name, ''), 'l_name', u.l_name,
      'contact_no', u.contact_no, 'sex', r.sex, 'birthdate', r.birthdate,
      'mobility_status', r.mobility_status,
      'emerg_contact_name', r.emerg_contact_name, 'emerg_contact_no', r.emerg_contact_no,
      'gps_lat', r.gps_lat, 'gps_long', r.gps_long,
      'address', coalesce(d.address, ''), 'landmark', coalesce(d.landmark, ''),
      'is_pregnant', coalesce(d.is_pregnant, false),
      'vulnerability_needs', coalesce(d.vulnerability_needs, ''),
      'household_members', coalesce(h.household_members, '[]'::jsonb),
      'household_id', coalesce(d.household_id::text, ''), 'household_name', '',
      'household_revision', h.updated_at,
      'revision', d.updated_at,
      'disability_ids', (select coalesce(jsonb_agg(rd.disability_id order by rd.disability_id), '[]'::jsonb)
        from public.resident_disabilities rd where rd.resident_uid = r.uid)
    )
  ) into result
  from public.residents r join public.users u on u.uid = r.uid
  join public.sitios s on s.sitio_id = r.sitio_id
  left join public.resident_profile_details d on d.resident_uid = r.uid
  left join public.households h on h.household_id = d.household_id
  where r.uid = p_uid;
  return result;
end;
$$;
revoke all on function public.get_resident_edit_profile(uuid) from public, anon;
grant execute on function public.get_resident_edit_profile(uuid) to authenticated;

create or replace function public.get_household_edit_details(p_household_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if not exists (select 1 from public.households h join public.users actor on actor.uid = auth.uid()
    where h.household_id = p_household_id and actor.account_status = 'active'
      and (actor.role::text = 'super_admin' or (actor.role::text = 'admin' and actor.assigned_sitio_id = h.sitio_id))) then
    raise exception 'Administrator access to this household is required.' using errcode = '42501';
  end if;
  select jsonb_build_object('household_members', h.household_members, 'household_revision', h.updated_at,
    'registered_members', (select coalesce(jsonb_agg(jsonb_build_object(
      'uid', u.uid, 'name', concat_ws(' ', u.f_name, u.m_name, u.l_name), 'is_head', u.uid = h.head_uid
    ) order by u.f_name), '[]'::jsonb) from public.resident_profile_details d
      join public.users u on u.uid = d.resident_uid where d.household_id = h.household_id)) into result
  from public.households h where h.household_id = p_household_id;
  return result;
end;
$$;
revoke all on function public.get_household_edit_details(uuid) from public, anon;
grant execute on function public.get_household_edit_details(uuid) to authenticated;

create or replace function public.update_resident_demographics(p_uid uuid, p_profile jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  member jsonb;
  field_name text;
  current_revision timestamptz;
  selected_household uuid;
  old_household uuid;
  household_revision timestamptz;
  target_sitio integer;
begin
  -- Serialize saves for this resident, including the first supplemental record.
  perform 1 from public.residents where uid = p_uid for update;
  perform public.assert_resident_edit_access(p_uid);
  select sitio_id into target_sitio from public.residents where uid = p_uid;
  selected_household := nullif(p_profile->>'household_id', '')::uuid;
  select household_id into old_household from public.resident_profile_details where resident_uid = p_uid;
  if old_household is distinct from selected_household and exists (
    select 1 from public.households where household_id = old_household and head_uid = p_uid
  ) then raise exception 'The household head cannot leave. Keep this household selected.'; end if;
  if jsonb_typeof(p_profile) is distinct from 'object' then
    raise exception 'Invalid resident profile.';
  end if;
  select updated_at into current_revision from public.resident_profile_details where resident_uid = p_uid;
  if current_revision is distinct from nullif(p_profile->>'revision', '')::timestamptz then
    raise exception 'This profile was edited by another administrator. Reopen it before saving.';
  end if;
  foreach field_name in array array['f_name','l_name','contact_no','emerg_contact_name','emerg_contact_no'] loop
    if coalesce(btrim(p_profile->>field_name), '') = '' then
      raise exception 'Names, contact number, and emergency contact details are required.';
    end if;
  end loop;
  if (p_profile->>'sex') is null or (p_profile->>'sex') not in ('male','female')
    or (p_profile->>'mobility_status') is null
    or (p_profile->>'mobility_status') not in ('ambulatory','semi_ambulatory','non_ambulatory') then
    raise exception 'Invalid sex or mobility value.';
  end if;
  if nullif(p_profile->>'birthdate','') is null or (p_profile->>'birthdate')::date > current_date then
    raise exception 'A valid birthdate is required.';
  end if;
  if (p_profile->>'gps_lat') is null or (p_profile->>'gps_long') is null
    or not ((p_profile->>'gps_lat')::numeric between -90 and 90)
    or not ((p_profile->>'gps_long')::numeric between -180 and 180) then
    raise exception 'GPS coordinates are out of range.';
  end if;
  if length(coalesce(p_profile->>'address','')) > 500
    or length(coalesce(p_profile->>'landmark','')) > 500
    or length(coalesce(p_profile->>'vulnerability_needs','')) > 2000 then
    raise exception 'Address, landmark, or assistance notes are too long.';
  end if;
  if jsonb_typeof(p_profile->'household_members') is distinct from 'array'
    or jsonb_typeof(p_profile->'disability_ids') is distinct from 'array' then
    raise exception 'Household members and disabilities must be lists.';
  end if;
  if jsonb_array_length(p_profile->'household_members') > 30 then
    raise exception 'A maximum of 30 dependent members is supported.';
  end if;
  if selected_household is not null then
    select updated_at into household_revision from public.households
      where household_id = selected_household and sitio_id = target_sitio for update;
    if not found then raise exception 'Select a household in this resident''s sitio.'; end if;
    if household_revision is distinct from nullif(p_profile->>'household_revision','')::timestamptz then
      raise exception 'This household was edited by another administrator. Reopen it before saving.';
    end if;
  elsif coalesce(btrim(p_profile->>'household_name'),'') <> '' then
    insert into public.households(household_name,sitio_id,head_uid,updated_by)
      values(btrim(p_profile->>'household_name'),target_sitio,p_uid,auth.uid()) returning household_id into selected_household;
  elsif jsonb_array_length(p_profile->'household_members') > 0 then
    raise exception 'Create or select a household before adding dependents.';
  end if;
  for member in select value from jsonb_array_elements(p_profile->'household_members') loop
    if jsonb_typeof(member) is distinct from 'object'
      or coalesce(btrim(member->>'name'),'') = '' or length(member->>'name') > 200
      or coalesce(btrim(member->>'relationship'),'') = '' or length(member->>'relationship') > 80
      or coalesce(member->>'sex','') not in ('','male','female')
      or length(coalesce(member->>'needs','')) > 2000
      or jsonb_typeof(member->'is_pregnant') is distinct from 'boolean' then
      raise exception 'Each household member needs a valid name, relationship, and demographic details.';
    end if;
    if nullif(member->>'birthdate','')::date > current_date then
      raise exception 'Household birthdates cannot be in the future.';
    end if;
  end loop;
  if exists (
    select 1 from jsonb_array_elements_text(p_profile->'disability_ids') ids(value)
    where not exists (select 1 from public.disability_types t where t.disability_id = ids.value::integer)
  ) then raise exception 'Unknown disability category.'; end if;

  update public.users set
    f_name = btrim(p_profile->>'f_name'), m_name = nullif(btrim(p_profile->>'m_name'),''),
    l_name = btrim(p_profile->>'l_name'), contact_no = btrim(p_profile->>'contact_no')
  where uid = p_uid;
  update public.residents set
    sex = (p_profile->>'sex')::public.sex_type,
    birthdate = (p_profile->>'birthdate')::date,
    mobility_status = (p_profile->>'mobility_status')::public.mobility_type,
    emerg_contact_name = btrim(p_profile->>'emerg_contact_name'),
    emerg_contact_no = btrim(p_profile->>'emerg_contact_no'),
    gps_lat = (p_profile->>'gps_lat')::numeric, gps_long = (p_profile->>'gps_long')::numeric
  where uid = p_uid;
  delete from public.resident_disabilities where resident_uid = p_uid;
  insert into public.resident_disabilities(resident_uid, disability_id)
    select distinct p_uid, value::integer from jsonb_array_elements_text(p_profile->'disability_ids');
  insert into public.resident_profile_details(
    resident_uid, address, landmark, is_pregnant, vulnerability_needs, household_id, updated_at, updated_by
  ) values (
    p_uid, btrim(coalesce(p_profile->>'address','')), btrim(coalesce(p_profile->>'landmark','')),
    coalesce((p_profile->>'is_pregnant')::boolean,false), coalesce(p_profile->>'vulnerability_needs',''),
    selected_household, clock_timestamp(), auth.uid()
  ) on conflict (resident_uid) do update set
    address = excluded.address, landmark = excluded.landmark, is_pregnant = excluded.is_pregnant,
    vulnerability_needs = excluded.vulnerability_needs, household_id = excluded.household_id,
    updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  if selected_household is not null then
    update public.households set household_members = p_profile->'household_members',
      updated_at = clock_timestamp(), updated_by = auth.uid() where household_id = selected_household;
  end if;
end;
$$;
revoke all on function public.update_resident_demographics(uuid,jsonb) from public, anon;
grant execute on function public.update_resident_demographics(uuid,jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
