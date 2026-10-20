-- PriorityCare step 2a: household members as rows, login-linked accounts, private ID uploads
-- =================================================================
-- Run after 20261019_01..03. One transaction.
--
-- 1. Accounts: every public.users row must be a real Supabase Auth login.
--    Mock users with no login (and the mock records hanging off them) are
--    removed, users.uid becomes a foreign key to auth.users, and the
--    plain-text users.pin column is dropped (PINs become hashed Auth
--    passwords).
-- 2. Households: the JSON list households.household_members becomes the
--    table public.household_members (one row per dependent, with the
--    app's age group and mobility), plus member_disabilities. House type,
--    tenure, floor level and unit number move onto households. The web's
--    existing functions keep returning the same JSON shape (now with
--    member_id, age_group, mobility and disability_ids added).
-- 3. Rescuers can read resident, household and member records (field map).
-- 4. Storage: verification-docs and house-facades become private. Residents
--    upload into a folder named after their own user id; staff of their
--    barangay (and rescuers, for facade photos) read them.

begin;

-- ---------------------------------------------------------------
-- 1. Accounts
-- ---------------------------------------------------------------
create temporary table orphan_users on commit drop as
  select u.uid from public.users u where not exists (select 1 from auth.users a where a.id = u.uid);

delete from public.dispatch_ticket_events e using public.dispatch_tickets t
  where e.ticket_id = t.ticket_id and t.resident_uid in (select uid from orphan_users);
delete from public.dispatch_tickets where resident_uid in (select uid from orphan_users);
delete from public.missing_person_report_audit a using public.missing_person_reports m
  where a.report_id = m.report_id
    and (m.resident_uid in (select uid from orphan_users) or m.matched_resident_uid in (select uid from orphan_users));
delete from public.missing_person_reports
  where resident_uid in (select uid from orphan_users) or matched_resident_uid in (select uid from orphan_users);
delete from public.evacuation_records
  where resident_uid in (select uid from orphan_users) or rescuer_uid in (select uid from orphan_users);
delete from public.sos_alerts where resident_uid in (select uid::text from orphan_users);
update public.resident_profile_details set household_id = null
  where household_id in (select household_id from public.households where head_uid in (select uid from orphan_users));
delete from public.households where head_uid in (select uid from orphan_users);
delete from public.residents where uid in (select uid from orphan_users);
delete from public.users where uid in (select uid from orphan_users);
update public.rescue_units
  set member_uids = array(select m from unnest(member_uids) m where m not in (select uid from orphan_users));

alter table public.users
  add constraint users_uid_auth_fkey foreign key (uid) references auth.users(id) on delete cascade;
alter table public.users drop column if exists pin;

-- ---------------------------------------------------------------
-- 2. Households and members
-- ---------------------------------------------------------------
alter table public.households
  add column if not exists house_type text check (house_type in ('concrete', 'mixed', 'light')),
  add column if not exists tenure text check (tenure in ('owner', 'renter', 'boarder')),
  add column if not exists floor_level text check (floor_level in ('ground', 'floor2', 'floor3')),
  add column if not exists unit_no text not null default '' check (length(unit_no) <= 100);

create table public.household_members (
  member_id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(household_id) on delete cascade,
  full_name text not null check (length(btrim(full_name)) between 1 and 200),
  relationship text not null default '' check (length(relationship) <= 80),
  sex text check (sex in ('male', 'female')),
  birthdate date check (birthdate <= current_date),
  age_group text check (age_group in ('infant', 'child', 'adult', 'senior')),
  is_pregnant boolean not null default false,
  mobility text not null default 'ambulatory'
    check (mobility in ('ambulatory', 'assisted', 'wheelchair', 'bedridden')),
  needs text not null default '' check (length(needs) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
create index household_members_household on public.household_members(household_id);
comment on table public.household_members is
  'People in a household who have no login of their own (children, seniors, dependents). The household head and other registered residents are in public.residents.';

create table public.member_disabilities (
  member_id uuid not null references public.household_members(member_id) on delete cascade,
  disability_id integer not null references public.disability_types(disability_id),
  primary key (member_id, disability_id)
);

-- Move the JSON lists into rows (empty strings become nulls).
insert into public.household_members (household_id, full_name, relationship, sex, birthdate, is_pregnant, needs, updated_by)
select h.household_id,
       btrim(m->>'name'),
       coalesce(btrim(m->>'relationship'), ''),
       nullif(m->>'sex', ''),
       nullif(m->>'birthdate', '')::date,
       coalesce((m->>'is_pregnant')::boolean, false),
       coalesce(m->>'needs', ''),
       h.updated_by
from public.households h, jsonb_array_elements(h.household_members) m
where coalesce(btrim(m->>'name'), '') <> '';

-- Same JSON shape the web already reads, plus the new fields.
create or replace function public.household_members_json(p_household uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'member_id', m.member_id, 'name', m.full_name, 'relationship', m.relationship,
      'birthdate', coalesce(m.birthdate::text, ''), 'sex', coalesce(m.sex, ''),
      'is_pregnant', m.is_pregnant, 'needs', m.needs,
      'age_group', coalesce(m.age_group, ''), 'mobility', m.mobility,
      'disability_ids', (select coalesce(jsonb_agg(md.disability_id order by md.disability_id), '[]'::jsonb)
                         from public.member_disabilities md where md.member_id = m.member_id)
    ) order by m.created_at, m.full_name), '[]'::jsonb)
  from public.household_members m where m.household_id = p_household
$$;
revoke all on function public.household_members_json(uuid) from public, anon, authenticated;

-- Replace a household's member list with p_members (JSON array in the shape above).
-- Rows whose member_id is in the list are updated, new ones inserted, the rest deleted.
create or replace function public.sync_household_members(p_household uuid, p_members jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare m jsonb; v_id uuid;
begin
  if jsonb_typeof(p_members) is distinct from 'array' then
    raise exception 'Household members must be a list.';
  end if;
  if jsonb_array_length(p_members) > 30 then
    raise exception 'A maximum of 30 household members is supported.';
  end if;
  delete from public.household_members hm
  where hm.household_id = p_household
    and hm.member_id not in (
      select (e->>'member_id')::uuid from jsonb_array_elements(p_members) e
      where coalesce(e->>'member_id', '') <> '');
  for m in select value from jsonb_array_elements(p_members) loop
    if coalesce(btrim(m->>'name'), '') = '' then
      raise exception 'Each household member needs a name.';
    end if;
    v_id := nullif(m->>'member_id', '')::uuid;
    if v_id is not null and exists (select 1 from public.household_members
                                    where member_id = v_id and household_id = p_household) then
      update public.household_members set
        full_name = btrim(m->>'name'),
        relationship = coalesce(btrim(m->>'relationship'), ''),
        sex = nullif(m->>'sex', ''),
        birthdate = nullif(m->>'birthdate', '')::date,
        age_group = nullif(m->>'age_group', ''),
        is_pregnant = coalesce((m->>'is_pregnant')::boolean, false),
        mobility = coalesce(nullif(m->>'mobility', ''), 'ambulatory'),
        needs = coalesce(m->>'needs', ''),
        updated_at = clock_timestamp(), updated_by = auth.uid()
      where member_id = v_id;
    else
      insert into public.household_members (household_id, full_name, relationship, sex, birthdate, age_group,
                                            is_pregnant, mobility, needs, updated_by)
      values (p_household, btrim(m->>'name'), coalesce(btrim(m->>'relationship'), ''), nullif(m->>'sex', ''),
              nullif(m->>'birthdate', '')::date, nullif(m->>'age_group', ''),
              coalesce((m->>'is_pregnant')::boolean, false), coalesce(nullif(m->>'mobility', ''), 'ambulatory'),
              coalesce(m->>'needs', ''), auth.uid())
      returning member_id into v_id;
    end if;
    if jsonb_typeof(m->'disability_ids') = 'array' then
      delete from public.member_disabilities where member_id = v_id;
      insert into public.member_disabilities (member_id, disability_id)
        select distinct v_id, value::integer from jsonb_array_elements_text(m->'disability_ids');
    end if;
  end loop;
end;
$$;
revoke all on function public.sync_household_members(uuid, jsonb) from public, anon, authenticated;

-- Point the existing web functions at the new table. Each replacement must
-- match the live definition exactly once, or the whole migration stops.
do $$
declare
  def text;
  fixes text[][] := array[
    array['get_resident_edit_profile',
          $a$'household_members', coalesce(h.household_members, '[]'::jsonb),$a$,
          $b$'household_members', public.household_members_json(h.household_id),$b$],
    array['get_household_edit_details',
          $a$jsonb_build_object('household_members', h.household_members,$a$,
          $b$jsonb_build_object('household_members', public.household_members_json(h.household_id),$b$],
    array['update_resident_demographics',
          $a$update public.households set household_members = p_profile->'household_members',$a$,
          $b$perform public.sync_household_members(selected_household, p_profile->'household_members');
    update public.households set$b$],
    array['update_resident_demographics',
          $a$or jsonb_typeof(member->'is_pregnant') is distinct from 'boolean' then$a$,
          $b$or jsonb_typeof(member->'is_pregnant') is distinct from 'boolean'
      or coalesce(nullif(member->>'mobility', ''), 'ambulatory') not in ('ambulatory','assisted','wheelchair','bedridden')
      or coalesce(member->>'age_group', '') not in ('','infant','child','adult','senior') then$b$],
    array['get_evacuee_household',
          $a$'name', m->>'name', 'relationship', m->>'relationship', 'sex', m->>'sex', 'birthdate', m->>'birthdate')), '[]'::jsonb)$a$,
          $b$'member_id', m.member_id, 'name', m.full_name, 'relationship', m.relationship, 'sex', m.sex,
        'birthdate', m.birthdate, 'age_group', m.age_group, 'mobility', m.mobility) order by m.created_at), '[]'::jsonb)$b$],
    array['get_evacuee_household',
          $a$from public.households h, jsonb_array_elements(h.household_members) m
    where h.household_id = person.household_id;$a$,
          $b$from public.household_members m
    where m.household_id = person.household_id;$b$]
  ];
  i int;
  fn text;
  hits int;
begin
  for i in 1 .. array_length(fixes, 1) loop
    fn := fixes[i][1];
    select pg_get_functiondef(p.oid) into def from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.proname = fn;
    hits := (length(def) - length(replace(def, fixes[i][2], ''))) / length(fixes[i][2]);
    if hits <> 1 then
      raise exception 'Step 2: expected 1 match in %, found % (fix %)', fn, hits, i;
    end if;
    execute replace(def, fixes[i][2], fixes[i][3]);
  end loop;

  -- Dependents count in shelter planning (two places).
  select pg_get_functiondef(p.oid) into def from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'get_shelter_assignments';
  if def !~ 'sum\(jsonb_array_length\(h\.household_members\)\)' then
    raise exception 'Step 2: get_shelter_assignments no longer counts household_members as expected';
  end if;
  def := regexp_replace(def,
    'coalesce\(sum\(jsonb_array_length\(h\.household_members\)\), 0\) from public\.households h where h\.barangay_id = ([a-z]+)\.barangay_id',
    'count(*) from public.household_members hm join public.households h on h.household_id = hm.household_id where h.barangay_id = \1.barangay_id',
    'g');
  if def ~ 'household_members\)' then
    raise exception 'Step 2: get_shelter_assignments still reads the JSON list';
  end if;
  execute def;
end $$;

alter table public.households drop constraint if exists household_members_array;
alter table public.households drop column household_members;

-- Row access: staff of the household's barangay, rescuers, and the household's own residents.
create or replace function public.can_read_household(p_household uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.households h
    where h.household_id = p_household
      and (public.staff_can_access_barangay(h.barangay_id)
        or public.is_active_rescuer()
        or h.head_uid = auth.uid()
        or exists (select 1 from public.resident_profile_details d
                   where d.household_id = h.household_id and d.resident_uid = auth.uid()))
  );
$$;
revoke all on function public.can_read_household(uuid) from public, anon;
grant execute on function public.can_read_household(uuid) to authenticated;

alter table public.household_members enable row level security;
alter table public.member_disabilities enable row level security;
revoke all on public.household_members, public.member_disabilities from anon, authenticated;
grant select on public.household_members, public.member_disabilities to authenticated;
create policy household_members_read on public.household_members
  for select to authenticated using (public.can_read_household(household_id));
create policy member_disabilities_read on public.member_disabilities
  for select to authenticated using (exists (
    select 1 from public.household_members m where m.member_id = member_disabilities.member_id
      and public.can_read_household(m.household_id)));

-- ---------------------------------------------------------------
-- 3. Rescuers and residents can read what the field app needs
-- ---------------------------------------------------------------
create policy households_read_rescuer_or_member on public.households
  for select to authenticated using (public.can_read_household(household_id));

create policy residents_select_rescuer on public.residents
  for select to authenticated using (public.is_active_rescuer());
create policy users_select_rescuer on public.users
  for select to authenticated using (role::text = 'resident' and public.is_active_rescuer());
create policy profile_details_read_own_or_rescuer on public.resident_profile_details
  for select to authenticated using (resident_uid = auth.uid() or public.is_active_rescuer());
create policy resident_disabilities_select_rescuer on public.resident_disabilities
  for select to authenticated using (public.is_active_rescuer());

-- ---------------------------------------------------------------
-- 4. Private uploads
-- ---------------------------------------------------------------
alter table public.verification_documents
  add column if not exists id_number text not null default '' check (length(id_number) <= 100);

update storage.buckets set public = false where id in ('verification-docs', 'house-facades');
drop policy if exists "Allow public uploads" on storage.objects;

-- Residents upload into <their uid>/... ; files cannot be overwritten or deleted from the app.
create policy prioritycare_upload_own on storage.objects
  for insert to authenticated
  with check (bucket_id in ('verification-docs', 'house-facades')
              and (storage.foldername(name))[1] = auth.uid()::text);

create policy prioritycare_read_uploads on storage.objects
  for select to authenticated
  using (bucket_id in ('verification-docs', 'house-facades') and (
    (storage.foldername(name))[1] = auth.uid()::text
    or (case when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             then public.staff_can_access_resident(((storage.foldername(name))[1])::uuid) else false end)
    or (bucket_id = 'house-facades' and public.is_active_rescuer())
  ));

notify pgrst, 'reload schema';

commit;
