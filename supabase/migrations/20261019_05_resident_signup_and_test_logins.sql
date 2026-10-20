-- PriorityCare step 2b: resident sign-up, resident self-service, test logins
-- =================================================================
-- Run after 20261019_04. One transaction.
--
-- 1. Residents sign in with their contact number and a 6-digit PIN. The PIN
--    is the Supabase Auth password of a login whose email is derived from the
--    contact number (resident_login_email). The register-resident Edge
--    Function creates that login and then calls complete_resident_registration
--    to write the user, resident, household and member rows in one go.
-- 2. Resident self-service RPCs for the app: get_my_profile,
--    update_my_household, set_my_house_photo, submit_my_verification_document.
--    Residents can no longer insert documents that are already reviewed.
-- 3. Test logins for every role (listed in TEST_LOGINS.md, not in git):
--    2 rescuers and 5 resident households in Alegria, Bangbang, Buagsong and
--    Poblacion. The three existing resident logins (Juan, Maria, Pedro) are
--    switched to contact number + PIN sign-in.

begin;

-- ---------------------------------------------------------------
-- 1. Sign-up
-- ---------------------------------------------------------------

-- 0917 123 4567, +63 917 123 4567 and 9171234567 all become 09171234567.
create or replace function public.normalize_contact_no(p_contact text)
returns text language sql immutable set search_path = '' as $$
  select case when d ~ '^63[0-9]{10}$' then '0' || substr(d, 3)
              when d ~ '^9[0-9]{9}$' then '0' || d
              else d end
  from (select regexp_replace(coalesce(p_contact, ''), '[^0-9]', '', 'g') d) x
$$;

-- The Auth email behind a resident's contact number. The app uses the same
-- rule to sign in, so keep the two in step.
create or replace function public.resident_login_email(p_contact text)
returns text language sql immutable set search_path = '' as $$
  select public.normalize_contact_no(p_contact) || '@resident.prioritycare.local'
$$;
grant execute on function public.normalize_contact_no(text), public.resident_login_email(text)
  to anon, authenticated, service_role;

-- Writes every row of a new resident for an Auth user the Edge Function just
-- created. p is the registration form:
--   f_name, m_name, l_name, contact_no, sex, birthdate, mobility_status,
--   emerg_contact_name, emerg_contact_no, barangay_id, sitio, address,
--   landmark, gps_lat, gps_long, is_pregnant, vulnerability_needs,
--   disability_ids[], household { house_type, tenure, floor_level, unit_no,
--   members[] in the household_members_json shape }.
create or replace function public.complete_resident_registration(p_uid uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_contact text := public.normalize_contact_no(p->>'contact_no');
  v_barangay integer := nullif(p->>'barangay_id', '')::integer;
  v_lat numeric := nullif(p->>'gps_lat', '')::numeric;
  v_lng numeric := nullif(p->>'gps_long', '')::numeric;
  v_house jsonb := coalesce(p->'household', '{}'::jsonb);
  v_household uuid;
  field_name text;
begin
  if jsonb_typeof(p) is distinct from 'object' then
    raise exception 'Invalid registration.';
  end if;
  if not exists (select 1 from auth.users where id = p_uid) then
    raise exception 'The login for this registration does not exist.';
  end if;
  if exists (select 1 from public.users where uid = p_uid) then
    raise exception 'This account is already registered.';
  end if;
  foreach field_name in array array['f_name', 'l_name', 'emerg_contact_name', 'emerg_contact_no'] loop
    if coalesce(btrim(p->>field_name), '') = '' then
      raise exception 'Name and emergency contact details are required.';
    end if;
  end loop;
  if v_contact !~ '^09[0-9]{9}$' then
    raise exception 'Enter a mobile number like 09171234567.';
  end if;
  if exists (select 1 from public.users where public.normalize_contact_no(contact_no) = v_contact) then
    raise exception 'This contact number is already registered.';
  end if;
  if coalesce(p->>'sex', '') not in ('male', 'female')
     or coalesce(p->>'mobility_status', '') not in ('ambulatory', 'semi_ambulatory', 'non_ambulatory') then
    raise exception 'Invalid sex or mobility value.';
  end if;
  if nullif(p->>'birthdate', '') is null or (p->>'birthdate')::date > current_date then
    raise exception 'A valid birthdate is required.';
  end if;
  if v_barangay is null or not exists (select 1 from public.barangays where barangay_id = v_barangay) then
    raise exception 'Select your barangay.';
  end if;
  -- No GPS fix yet: start at the barangay centre; staff or the resident can move the pin later.
  if v_lat is null or v_lng is null then
    select center_lat, center_lng into v_lat, v_lng from public.barangays where barangay_id = v_barangay;
  end if;
  if v_lat is null or v_lng is null or v_lat not between -90 and 90 or v_lng not between -180 and 180 then
    raise exception 'GPS coordinates are out of range.';
  end if;
  if jsonb_typeof(coalesce(p->'disability_ids', '[]'::jsonb)) <> 'array'
     or exists (select 1 from jsonb_array_elements_text(coalesce(p->'disability_ids', '[]'::jsonb)) ids(value)
                where not exists (select 1 from public.disability_types t where t.disability_id = ids.value::integer)) then
    raise exception 'Unknown disability category.';
  end if;

  insert into public.users (uid, role, email, f_name, m_name, l_name, contact_no, is_verified, account_status)
  values (p_uid, 'resident', public.resident_login_email(v_contact), btrim(p->>'f_name'),
          nullif(btrim(p->>'m_name'), ''), btrim(p->>'l_name'), v_contact, false, 'active');
  insert into public.residents (uid, barangay_id, sitio, sex, birthdate, mobility_status,
                                emerg_contact_name, emerg_contact_no, gps_lat, gps_long)
  values (p_uid, v_barangay, btrim(coalesce(p->>'sitio', '')), (p->>'sex')::public.sex_type,
          (p->>'birthdate')::date, (p->>'mobility_status')::public.mobility_type,
          btrim(p->>'emerg_contact_name'), public.normalize_contact_no(p->>'emerg_contact_no'), v_lat, v_lng);
  insert into public.resident_disabilities (resident_uid, disability_id)
    select distinct p_uid, value::integer from jsonb_array_elements_text(coalesce(p->'disability_ids', '[]'::jsonb));

  insert into public.households (household_name, barangay_id, head_uid, sitio, house_type, tenure,
                                 floor_level, unit_no, updated_by)
  values (coalesce(nullif(btrim(v_house->>'household_name'), ''), btrim(p->>'l_name') || ' Household'),
          v_barangay, p_uid, btrim(coalesce(p->>'sitio', '')), nullif(v_house->>'house_type', ''),
          nullif(v_house->>'tenure', ''), nullif(v_house->>'floor_level', ''),
          btrim(coalesce(v_house->>'unit_no', '')), p_uid)
  returning household_id into v_household;
  perform public.sync_household_members(v_household, coalesce(v_house->'members', '[]'::jsonb));

  insert into public.resident_profile_details (resident_uid, address, landmark, is_pregnant,
                                               vulnerability_needs, household_id, updated_by)
  values (p_uid, btrim(coalesce(p->>'address', '')), btrim(coalesce(p->>'landmark', '')),
          coalesce((p->>'is_pregnant')::boolean, false), coalesce(p->>'vulnerability_needs', ''),
          v_household, p_uid);

  return jsonb_build_object('uid', p_uid, 'household_id', v_household,
                            'email', public.resident_login_email(v_contact));
end;
$$;
revoke all on function public.complete_resident_registration(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.complete_resident_registration(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------
-- 2. Resident self-service
-- ---------------------------------------------------------------
create or replace function public.get_my_profile()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'uid', u.uid, 'role', u.role, 'is_verified', coalesce(u.is_verified, false),
    'account_status', u.account_status,
    'f_name', u.f_name, 'm_name', coalesce(u.m_name, ''), 'l_name', u.l_name, 'contact_no', u.contact_no,
    'assigned_barangay_id', u.assigned_barangay_id,
    'resident', case when r.uid is null then null else jsonb_build_object(
      'barangay_id', r.barangay_id, 'barangay_name', b.barangay_name, 'sitio', r.sitio,
      'sex', r.sex, 'birthdate', r.birthdate, 'mobility_status', r.mobility_status,
      'emerg_contact_name', r.emerg_contact_name, 'emerg_contact_no', r.emerg_contact_no,
      'gps_lat', r.gps_lat, 'gps_long', r.gps_long, 'house_photo_path', r.house_photo_url,
      'address', coalesce(d.address, ''), 'landmark', coalesce(d.landmark, ''),
      'is_pregnant', coalesce(d.is_pregnant, false), 'vulnerability_needs', coalesce(d.vulnerability_needs, ''),
      'disability_ids', (select coalesce(jsonb_agg(rd.disability_id order by rd.disability_id), '[]'::jsonb)
                         from public.resident_disabilities rd where rd.resident_uid = r.uid)) end,
    'household', case when h.household_id is null then null else jsonb_build_object(
      'household_id', h.household_id, 'household_name', h.household_name, 'is_head', h.head_uid = u.uid,
      'house_type', h.house_type, 'tenure', h.tenure, 'floor_level', h.floor_level, 'unit_no', h.unit_no,
      'members', public.household_members_json(h.household_id)) end,
    'documents', (select coalesce(jsonb_agg(jsonb_build_object(
        'doc_id', v.doc_id, 'type_id', v.type_id, 'review_status', v.review_status,
        'id_number', v.id_number, 'rejection_reason', v.rejection_reason, 'uploaded_at', v.uploaded_at)
        order by v.uploaded_at desc), '[]'::jsonb)
      from public.verification_documents v where v.uid = u.uid))
  from public.users u
  left join public.residents r on r.uid = u.uid
  left join public.barangays b on b.barangay_id = r.barangay_id
  left join public.resident_profile_details d on d.resident_uid = u.uid
  left join public.households h on h.household_id = coalesce(d.household_id,
    (select h2.household_id from public.households h2 where h2.head_uid = u.uid limit 1))
  where u.uid = auth.uid()
$$;

-- The household head updates the house details and dependents.
-- p: { sitio, landmark, house_type, tenure, floor_level, unit_no, members[] }
create or replace function public.update_my_household(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_household uuid;
begin
  select household_id into v_household from public.households where head_uid = auth.uid() for update;
  if v_household is null then
    raise exception 'Only the household head can edit the household.';
  end if;
  if jsonb_typeof(p) is distinct from 'object' then
    raise exception 'Invalid household.';
  end if;
  update public.households set
    sitio = btrim(coalesce(p->>'sitio', sitio)),
    house_type = case when p ? 'house_type' then nullif(p->>'house_type', '') else house_type end,
    tenure = case when p ? 'tenure' then nullif(p->>'tenure', '') else tenure end,
    floor_level = case when p ? 'floor_level' then nullif(p->>'floor_level', '') else floor_level end,
    unit_no = btrim(coalesce(p->>'unit_no', unit_no)),
    updated_at = clock_timestamp(), updated_by = auth.uid()
  where household_id = v_household;
  if p ? 'sitio' then
    update public.residents set sitio = btrim(p->>'sitio') where uid = auth.uid();
  end if;
  if p ? 'landmark' then
    update public.resident_profile_details set landmark = btrim(p->>'landmark'),
      updated_at = clock_timestamp(), updated_by = auth.uid()
    where resident_uid = auth.uid();
  end if;
  if p ? 'members' then
    perform public.sync_household_members(v_household, p->'members');
  end if;
  return public.household_members_json(v_household);
end;
$$;

-- Facade photo already uploaded to house-facades/<uid>/...
create or replace function public.set_my_house_photo(p_path text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(p_path, '') not like auth.uid()::text || '/%' then
    raise exception 'Upload the photo into your own folder first.';
  end if;
  update public.residents set house_photo_url = p_path where uid = auth.uid();
  if not found then raise exception 'Only residents can set a house photo.'; end if;
end;
$$;

-- ID already uploaded to verification-docs/<uid>/...; staff review it on the web.
create or replace function public.submit_my_verification_document(p_type_id integer, p_path text, p_id_number text)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_doc integer;
begin
  if coalesce(p_path, '') not like auth.uid()::text || '/%' then
    raise exception 'Upload the ID into your own folder first.';
  end if;
  if not exists (select 1 from public.document_types where type_id = p_type_id) then
    raise exception 'Unknown ID type.';
  end if;
  if not exists (select 1 from public.residents where uid = auth.uid()) then
    raise exception 'Only residents submit verification documents.';
  end if;
  insert into public.verification_documents (uid, type_id, file_url, id_number, review_status)
  values (auth.uid(), p_type_id, p_path, btrim(coalesce(p_id_number, '')), 'pending')
  returning doc_id into v_doc;
  return v_doc;
end;
$$;

revoke all on function public.get_my_profile(), public.update_my_household(jsonb),
  public.set_my_house_photo(text), public.submit_my_verification_document(integer, text, text)
  from public, anon;
grant execute on function public.get_my_profile(), public.update_my_household(jsonb),
  public.set_my_house_photo(text), public.submit_my_verification_document(integer, text, text)
  to authenticated;

-- A resident's own document always starts unreviewed.
alter policy verification_documents_insert_own on public.verification_documents
  with check (uid = auth.uid() and coalesce(review_status::text, 'pending') = 'pending'
              and reviewed_by is null and reviewed_at is null);

-- ---------------------------------------------------------------
-- 3. Test logins
-- ---------------------------------------------------------------
create or replace function pg_temp.seed_login(p_id uuid, p_email text, p_password text) returns void
language plpgsql as $$
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', p_email,
          extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '')
  on conflict (id) do update set
    email = excluded.email, encrypted_password = excluded.encrypted_password,
    email_confirmed_at = coalesce(auth.users.email_confirmed_at, now()),
    confirmation_token = coalesce(auth.users.confirmation_token, ''),
    recovery_token = coalesce(auth.users.recovery_token, ''),
    email_change_token_new = coalesce(auth.users.email_change_token_new, ''),
    email_change = coalesce(auth.users.email_change, ''), updated_at = now();
  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (p_id::text, p_id, jsonb_build_object('sub', p_id::text, 'email', p_email, 'email_verified', true),
          'email', now(), now(), now())
  on conflict (provider_id, provider) do update set identity_data = excluded.identity_data, updated_at = now();
end;
$$;

-- Rescuers (password Rescue2026!)
select pg_temp.seed_login('aaaa0001-0000-4000-8000-000000000001', 'rescuer.alegria@prioritycare.local', 'Rescue2026!');
select pg_temp.seed_login('aaaa0001-0000-4000-8000-000000000002', 'rescuer.buagsong@prioritycare.local', 'Rescue2026!');
insert into public.users (uid, role, email, f_name, l_name, contact_no, is_verified, account_status, assigned_barangay_id) values
  ('aaaa0001-0000-4000-8000-000000000001', 'rescuer', 'rescuer.alegria@prioritycare.local', 'Rico', 'Fernandez', '09270000001', true, 'active', 1),
  ('aaaa0001-0000-4000-8000-000000000002', 'rescuer', 'rescuer.buagsong@prioritycare.local', 'Joy', 'Villanueva', '09270000002', true, 'active', 3)
on conflict (uid) do nothing;
update public.rescue_units set unit_name = 'Alegria Rescue 1', barangay_id = 1,
  member_uids = array(select distinct m from unnest(member_uids || 'aaaa0001-0000-4000-8000-000000000001'::uuid) m)
where unit_id = 1;
update public.rescue_units set unit_name = 'Buagsong Alpha Team', barangay_id = 3,
  member_uids = array(select distinct m from unnest(member_uids || 'aaaa0001-0000-4000-8000-000000000002'::uuid) m)
where unit_id = 2;
update public.evacuation_centers set center_name = 'Buagsong Covered Court' where center_name = 'Sitio 3 Covered Court';
update public.evacuation_centers set center_name = 'Alegria Barangay Hall' where center_name = 'Sitio 1 Barangay Hall';

-- Residents (contact number + PIN 123456). Juan, Maria and Pedro already exist.
create temporary table seed_residents on commit drop as
select * from (values
  ('11111111-1111-4111-a111-111111111111'::uuid, 'Juan',  'Dela Cruz', '09170001111', 1,  'Sitio Mahayahay', 'male',   '1985-03-12'::date, 'ambulatory',      'Liza Dela Cruz',  '09170009991', 0.0010,  0.0008, 'concrete', 'owner',  'ground', '', true,  'Beside the sari-sari store'),
  ('22222222-2222-4222-a222-222222222222'::uuid, 'Maria', 'Santos',    '09180002222', 2,  'Sitio Lawis',     'female', '1979-08-30'::date, 'ambulatory',      'Jose Santos',     '09180009992', -0.0012, 0.0006, 'mixed',    'owner',  'floor2', '', true,  'Blue gate near the chapel'),
  ('33333333-3333-4333-a333-333333333333'::uuid, 'Pedro', 'Reyes',     '09190003333', 3,  'Sitio Kalubihan', 'male',   '1992-11-05'::date, 'ambulatory',      'Carmen Reyes',    '09190009993', 0.0008,  -0.0010, 'light',   'renter', 'ground', 'Room 3', false, 'Behind the coconut grove'),
  ('44444444-4444-4444-a444-444444444444'::uuid, 'Ana',   'Lim',       '09200004444', 12, 'Sitio Tabay',     'female', '1990-01-20'::date, 'ambulatory',      'Ben Lim',         '09200009994', -0.0006, -0.0007, 'concrete', 'owner', 'floor3', 'Unit 3B', false, 'Apartment above the bakery'),
  ('55555555-5555-4555-a555-555555555555'::uuid, 'Rosa',  'Mercado',   '09210005555', 3,  'Sitio Bitoon',    'female', '1950-06-02'::date, 'semi_ambulatory', 'Paolo Mercado',   '09210009995', -0.0009, 0.0011, 'light',    'owner',  'ground', '', false, 'Near the seawall, green roof')
) v(uid, f_name, l_name, contact_no, barangay_id, sitio, sex, birthdate, mobility, emerg_name, emerg_no,
    dlat, dlng, house_type, tenure, floor_level, unit_no, is_verified, landmark);

select pg_temp.seed_login(s.uid, public.resident_login_email(s.contact_no), '123456') from seed_residents s;
insert into public.users (uid, role, email, f_name, l_name, contact_no, is_verified, account_status)
select uid, 'resident', public.resident_login_email(contact_no), f_name, l_name, contact_no, is_verified, 'active'
from seed_residents
on conflict (uid) do update set email = excluded.email, f_name = excluded.f_name, l_name = excluded.l_name,
  contact_no = excluded.contact_no, is_verified = excluded.is_verified;
insert into public.residents (uid, barangay_id, sitio, sex, birthdate, mobility_status, emerg_contact_name,
                              emerg_contact_no, gps_lat, gps_long)
select s.uid, s.barangay_id, s.sitio, s.sex::public.sex_type, s.birthdate, s.mobility::public.mobility_type,
       s.emerg_name, s.emerg_no, round(b.center_lat + s.dlat, 6), round(b.center_lng + s.dlng, 6)
from seed_residents s join public.barangays b using (barangay_id)
on conflict (uid) do update set barangay_id = excluded.barangay_id, sitio = excluded.sitio,
  sex = excluded.sex, birthdate = excluded.birthdate, mobility_status = excluded.mobility_status,
  emerg_contact_name = excluded.emerg_contact_name, emerg_contact_no = excluded.emerg_contact_no,
  gps_lat = excluded.gps_lat, gps_long = excluded.gps_long;

insert into public.households (household_id, household_name, barangay_id, head_uid, sitio, house_type,
                               tenure, floor_level, unit_no)
select ('bbbb0001-0000-4000-8000-' || lpad(row_number() over (order by uid)::text, 12, '0'))::uuid,
       l_name || ' Household', barangay_id, uid, sitio, house_type, tenure, floor_level, unit_no
from seed_residents s
where not exists (select 1 from public.households h where h.head_uid = s.uid);
insert into public.resident_profile_details (resident_uid, address, landmark, is_pregnant, vulnerability_needs, household_id)
select s.uid, s.sitio || ', ' || b.barangay_name || ', Cordova, Cebu', s.landmark, false,
       case when s.mobility = 'semi_ambulatory' then 'Uses a cane; needs help on stairs and rough ground.' else '' end,
       h.household_id
from seed_residents s join public.barangays b using (barangay_id)
join public.households h on h.head_uid = s.uid
on conflict (resident_uid) do update set address = excluded.address, landmark = excluded.landmark,
  vulnerability_needs = excluded.vulnerability_needs, household_id = excluded.household_id;
insert into public.resident_disabilities (resident_uid, disability_id)
values ('55555555-5555-4555-a555-555555555555', 3)
on conflict do nothing;

-- Dependents (only for households that have none yet, so re-running is safe).
insert into public.household_members (household_id, full_name, relationship, sex, birthdate, age_group,
                                      is_pregnant, mobility, needs)
select h.household_id, m.full_name, m.relationship, m.sex, m.birthdate, m.age_group, m.is_pregnant, m.mobility, m.needs
from (values
  ('11111111-1111-4111-a111-111111111111'::uuid, 'Liza Dela Cruz',   'Spouse',      'female', '1988-07-14'::date, 'adult',  true,  'ambulatory', 'Seven months pregnant'),
  ('11111111-1111-4111-a111-111111111111'::uuid, 'Miko Dela Cruz',   'Son',         'male',   '2016-04-09'::date, 'child',  false, 'ambulatory', ''),
  ('11111111-1111-4111-a111-111111111111'::uuid, 'Bea Dela Cruz',    'Daughter',    'female', '2026-02-10'::date, 'infant', false, 'assisted',   'Infant; needs formula and diapers'),
  ('22222222-2222-4222-a222-222222222222'::uuid, 'Carmen Santos',    'Mother',      'female', '1944-12-01'::date, 'senior', false, 'wheelchair', 'Wheelchair user; maintenance meds for hypertension'),
  ('44444444-4444-4444-a444-444444444444'::uuid, 'Ben Lim',          'Spouse',      'male',   '1987-09-18'::date, 'adult',  false, 'assisted',   'Recovering from knee surgery'),
  ('44444444-4444-4444-a444-444444444444'::uuid, 'Chloe Lim',        'Daughter',    'female', '2019-05-25'::date, 'child',  false, 'ambulatory', 'Asthma inhaler'),
  ('55555555-5555-4555-a555-555555555555'::uuid, 'Paolo Mercado',    'Grandson',    'male',   '2001-10-10'::date, 'adult',  false, 'ambulatory', 'Caregiver'),
  ('55555555-5555-4555-a555-555555555555'::uuid, 'Teodoro Mercado',  'Spouse',      'male',   '1947-02-15'::date, 'senior', false, 'bedridden',  'Bedridden; needs a stretcher and oxygen')
) m(head_uid, full_name, relationship, sex, birthdate, age_group, is_pregnant, mobility, needs)
join public.households h on h.head_uid = m.head_uid
where not exists (select 1 from public.household_members x where x.household_id = h.household_id);
insert into public.member_disabilities (member_id, disability_id)
select m.member_id, d.disability_id
from public.household_members m
join (values ('Carmen Santos', 3), ('Teodoro Mercado', 3), ('Teodoro Mercado', 1)) d(full_name, disability_id)
  on d.full_name = m.full_name
on conflict do nothing;

notify pgrst, 'reload schema';

commit;
