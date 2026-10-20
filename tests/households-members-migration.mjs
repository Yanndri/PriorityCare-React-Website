// SQL test for 20261019_04_households_and_accounts.sql against an isolated synthetic database.
// Usage: node tests/households-members-migration.mjs <PGlite-module-path-or-file-URL>
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const { PGlite } = await import(process.argv[2] ?? '@electric-sql/pglite')
const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto')
const db = await PGlite.create({ extensions: { pgcrypto } })
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const migration = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8')
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema storage; create schema extensions;
    create extension pgcrypto schema extensions;
    create table auth.users(instance_id uuid, id uuid primary key, aud text, role text, email text unique,
      encrypted_password text, email_confirmed_at timestamptz, raw_app_meta_data jsonb, raw_user_meta_data jsonb,
      created_at timestamptz, updated_at timestamptz, confirmation_token text, recovery_token text,
      email_change_token_new text, email_change text);
    create table auth.identities(id uuid primary key default gen_random_uuid(), provider_id text not null, user_id uuid not null,
      identity_data jsonb not null, provider text not null, last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz,
      unique(provider_id, provider));
    create function auth.uid() returns uuid language sql as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table storage.buckets(id text primary key, name text, public boolean);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    create function storage.foldername(name text) returns text[] language sql as $$select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1]$$;
    alter table storage.objects enable row level security;
    create policy "Allow public uploads" on storage.objects for insert with check (true);
    insert into storage.buckets values ('verification-docs', true), ('house-facades', true);
    create type public.sex_type as enum ('male','female');
    create type public.mobility_type as enum ('ambulatory','semi_ambulatory','non_ambulatory');
    create table public.barangays(barangay_id integer primary key,barangay_name text,center_lat numeric,center_lng numeric);
    create table public.users(uid uuid primary key, role text, account_status text,
      assigned_barangay_id integer, email text not null default '', f_name text not null,m_name text,l_name text not null,
      contact_no text not null, is_verified boolean default true, pin text);
    create table public.residents(uid uuid primary key references public.users(uid) on delete cascade,
      barangay_id integer references public.barangays(barangay_id), sex sex_type not null,
      birthdate date not null, mobility_status mobility_type not null,
      emerg_contact_name text not null,emerg_contact_no text not null,
      gps_lat numeric not null,gps_long numeric not null, sitio text not null default '', house_photo_url text);
    create table public.disability_types(disability_id integer primary key,disability_name text);
    create table public.resident_disabilities(resident_uid uuid references public.residents(uid) on delete cascade,
      disability_id integer references public.disability_types(disability_id),primary key(resident_uid,disability_id));
    create table public.evacuation_centers(center_id serial primary key,center_name text,center_type text not null default 'school',status text,capacity integer,gps_lat numeric,gps_long numeric);
    create type public.evac_status_type as enum ('pending','in_transit','safely_evacuated','failed');
    create table public.evacuation_records(record_id uuid primary key default gen_random_uuid(),resident_uid uuid not null references public.residents(uid),
      rescuer_uid uuid references public.users(uid),evac_center_id integer references public.evacuation_centers(center_id),evac_status public.evac_status_type not null,evacuated_at timestamptz,logged_at timestamptz default now());
    create table public.sos_alerts(alert_id uuid primary key default gen_random_uuid(), resident_uid varchar not null,
      alert_level integer not null default 1, alert_type varchar not null default 'flood', status varchar default 'active', created_at timestamptz default now());
    create table public.document_types(type_id integer primary key, type_name text unique, description text);
    insert into public.document_types values (2,'PhilSys / National ID');
    create table public.verification_documents(doc_id serial primary key, uid uuid references public.users(uid) on delete cascade,
      type_id integer, file_url text, review_status text default 'pending', reviewed_by uuid, reviewed_at timestamptz,
      rejection_reason text, uploaded_at timestamptz default now());
    alter table public.verification_documents enable row level security;
    create policy verification_documents_insert_own on public.verification_documents for insert with check (uid = auth.uid());
    create function public.is_active_rescuer() returns boolean language sql stable security definer as
      $$select exists(select 1 from public.users u where u.uid = auth.uid() and u.role = 'rescuer' and u.account_status = 'active')$$;
    create function public.staff_can_access_barangay(p integer) returns boolean language sql stable security definer as
      $$select exists(select 1 from public.users u where u.uid = auth.uid() and u.account_status = 'active'
        and (u.role = 'super_admin' or (u.role = 'admin' and u.assigned_barangay_id = p)))$$;
    create function public.staff_can_access_resident(p uuid) returns boolean language sql stable security definer as
      $$select exists(select 1 from public.residents r where r.uid = p and public.staff_can_access_barangay(r.barangay_id))$$;
    insert into public.barangays values (1,'Alegria',10.255,123.957),(2,'Bangbang',10.259,123.941),(3,'Buagsong',10.249,123.940),(12,'Poblacion',10.250,123.950);
    insert into public.disability_types values (1,'Visual'),(2,'Hearing'),(3,'Physical');
    insert into public.evacuation_centers(center_id,center_name,status,capacity,gps_lat,gps_long) values (10,'School','active',50,10.3,123.9);
    grant usage on schema public,auth,storage to authenticated;
    grant select, insert on storage.objects to authenticated;
  `)
  // 1 admin (brgy 1), 2 super admin, 3 rescuer, 4..5 residents with logins, 90..91 mock users with no login.
  for (const [n, role, brgy, hasLogin] of [[1,'admin',1,true],[2,'super_admin',null,true],[3,'rescuer',null,true],
    [4,'resident',null,true],[5,'resident',null,true],[90,'resident',null,false],[91,'rescuer',null,false]]) {
    if (hasLogin) await db.query('insert into auth.users(id) values ($1)', [uid(n)])
    await db.query(`insert into public.users(uid,role,account_status,assigned_barangay_id,f_name,l_name,contact_no,pin)
      values($1,$2,'active',$3,'Test','User','0917000000' || $4::text,'1234')`, [uid(n), role, brgy, n])
  }
  for (const n of [4, 5, 90]) await db.query(`insert into public.residents values
      ($1,$2,'female','1990-06-15','ambulatory','Contact','09170000001',10.3,123.9)`, [uid(n), n === 5 ? 2 : 1])

  await db.exec(await migration('20261014_resident_profile_editing.sql'))
  await db.exec(await migration('20261014_disaster_events.sql'))
  await db.exec(await migration('20261014_missing_person_reconciliation.sql'))
  await db.exec(await migration('20261017_family_reunification_lookup.sql'))
  await db.exec(await migration('20261017_sitio_shelter_catchments.sql'))
  await db.exec(await migration('20261014_facility_registration.sql'))
  await db.exec(await migration('20261014_facility_lifecycle.sql'))
  await db.exec(await migration('20261014_operational_audit_trail.sql'))
  await db.exec(await migration('20261017_rescue_dispatch_tickets.sql'))

  await db.exec(`
    insert into public.households(household_id,household_name,barangay_id,head_uid,household_members) values
      ('${uid(800)}','Santos Household',1,'${uid(4)}','[{"name":"Baby Santos","relationship":"Daughter","birthdate":"2024-05-01","sex":"female","is_pregnant":false,"needs":""},{"name":" ","relationship":"x"}]'),
      ('${uid(801)}','Mock Household',1,'${uid(90)}','[{"name":"Ghost","relationship":"Son"}]');
    insert into public.resident_profile_details(resident_uid,household_id) values ('${uid(4)}','${uid(800)}');
    insert into public.evacuation_records(resident_uid,rescuer_uid,evac_center_id,evac_status) values
      ('${uid(4)}','${uid(91)}',10,'safely_evacuated'),('${uid(90)}',null,10,'pending'),('${uid(5)}','${uid(3)}',10,'pending');
    insert into public.sos_alerts(resident_uid) values ('${uid(90)}'),('${uid(4)}');
    insert into public.rescue_units(unit_id, unit_name, member_uids) overriding system value values (1, 'Barangay Rescue 1', array['${uid(3)}','${uid(91)}']::uuid[]);
    insert into public.verification_documents(uid) values ('${uid(90)}');`)

  await db.exec(await migration('20261019_04_households_and_accounts.sql'))
  const one = async (sql, params = []) => (await db.query(sql, params)).rows[0]
  const all = async (sql, params = []) => (await db.query(sql, params)).rows

  // Accounts: mock users without logins and their records are gone; others untouched.
  assert.deepEqual((await all('select uid from public.users order by uid')).map(r => r.uid), [1,2,3,4,5].map(uid))
  assert.equal((await one('select count(*)::int n from public.evacuation_records')).n, 1)
  assert.equal((await one('select count(*)::int n from public.sos_alerts')).n, 1)
  assert.equal((await one('select count(*)::int n from public.households')).n, 1)
  assert.deepEqual((await one('select member_uids from public.rescue_units where unit_id = 1')).member_uids, [uid(3)])
  assert.equal((await one(`select count(*)::int n from information_schema.columns where table_name='users' and column_name='pin'`)).n, 0)
  await assert.rejects(db.query(`insert into public.users(uid,role,account_status,f_name,l_name,contact_no) values ($1,'resident','active','No','Login','0')`, [uid(99)]))

  // JSON list became rows; blank names were dropped.
  assert.deepEqual(await all('select full_name, relationship, sex, birthdate::text b, mobility from public.household_members'),
    [{ full_name: 'Baby Santos', relationship: 'Daughter', sex: 'female', b: '2024-05-01', mobility: 'ambulatory' }])
  assert.equal((await one(`select count(*)::int n from information_schema.columns where table_name='households' and column_name='household_members'`)).n, 0)

  async function actor(n) {
    await db.exec('reset role')
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [n ? uid(n) : ''])
    await db.exec('set role authenticated')
  }
  // Web functions return the same shape, now with member ids.
  await actor(1)
  const profile = (await one('select public.get_resident_edit_profile($1) d', [uid(4)])).d
  const members = profile.profile.household_members
  assert.equal(members.length, 1)
  assert.equal(members[0].name, 'Baby Santos')
  assert.equal(members[0].birthdate, '2024-05-01')
  assert.ok(members[0].member_id)
  const details = (await one('select public.get_household_edit_details($1) d', [uid(800)])).d
  assert.deepEqual(details.household_members, members)

  // Saving keeps the existing member (same id), edits it, adds one, removes none.
  const input = { ...profile.profile, household_members: [
    { ...members[0], needs: 'Formula milk', mobility: 'assisted', age_group: 'infant' },
    { name: 'Lola Santos', relationship: 'Grandmother', birthdate: '', sex: 'female', is_pregnant: false, needs: '', mobility: 'bedridden', age_group: 'senior', disability_ids: [2] }] }
  await db.query('select public.update_resident_demographics($1,$2)', [uid(4), JSON.stringify(input)])
  await db.exec('reset role')
  const after = (await one('select public.household_members_json($1) d', [uid(800)])).d
  await actor(1)
  assert.equal(after.length, 2)
  assert.equal(after[0].member_id, members[0].member_id)
  assert.equal(after[0].needs, 'Formula milk')
  assert.equal(after[0].mobility, 'assisted')
  assert.equal(after[1].mobility, 'bedridden')
  assert.deepEqual(after[1].disability_ids, [2])
  // Removing a member from the list deletes it.
  const again = (await one('select public.get_resident_edit_profile($1) d', [uid(4)])).d.profile
  await db.query('select public.update_resident_demographics($1,$2)', [uid(4), JSON.stringify({ ...again, household_members: [again.household_members[1]] })])
  assert.deepEqual((await all('select full_name from public.household_members')).map(r => r.full_name), ['Lola Santos'])
  // Invalid mobility is refused.
  const bad = (await one('select public.get_resident_edit_profile($1) d', [uid(4)])).d.profile
  await assert.rejects(db.query('select public.update_resident_demographics($1,$2)',
    [uid(4), JSON.stringify({ ...bad, household_members: [{ ...bad.household_members[0], mobility: 'flying' }] })]))

  // Reunification and shelter planning read the table.
  const hh = (await one('select public.get_evacuee_household($1) d', [uid(4)])).d
  assert.deepEqual(hh.dependents.map(d => d.name), ['Lola Santos'])
  const plan = (await one('select public.get_shelter_assignments() d')).d
  assert.equal(plan.barangays.find(b => b.barangay_id === 1).dependents, 1)

  // Row access: admin of brgy 1, rescuer and the household's own resident see the members; others don't.
  for (const [n, visible] of [[1, 1], [2, 1], [3, 1], [4, 1], [5, 0]]) {
    await actor(n)
    assert.equal((await one('select count(*)::int n from public.household_members')).n, visible, `actor ${n}`)
  }
  await db.exec('reset role')

  // Storage: buckets private, own-folder uploads only.
  assert.deepEqual((await all('select public from storage.buckets')).map(r => r.public), [false, false])
  await actor(4)
  await db.query(`insert into storage.objects(bucket_id,name) values ('verification-docs','${uid(4)}/id.jpg')`)
  await assert.rejects(db.query(`insert into storage.objects(bucket_id,name) values ('verification-docs','${uid(5)}/id.jpg')`))
  await actor(1)
  assert.equal((await one('select count(*)::int n from storage.objects')).n, 1)
  await actor(5)
  assert.equal((await one('select count(*)::int n from storage.objects')).n, 0)
  await db.exec('reset role')

  // Step 2b: sign-up, self-service, test logins.
  await db.exec(`alter table public.households add column if not exists sitio text not null default '';
    insert into public.rescue_units(unit_id, unit_name, member_uids) overriding system value values (2, 'Sitio 3 Alpha Team', '{}');
    insert into public.evacuation_centers(center_id,center_name,status,capacity,gps_lat,gps_long) values (11,'Sitio 3 Covered Court','active',80,10.25,123.94);`)
  await db.exec(await migration('20261019_05_resident_signup_and_test_logins.sql'))
  assert.equal((await one(`select public.resident_login_email('+63 917 123 4567') e`)).e, '09171234567@resident.prioritycare.local')
  // Seeded logins: password hashes check out, every login has an identity.
  assert.equal((await one(`select count(*)::int n from auth.users where email like '%@resident.prioritycare.local'
    and encrypted_password = extensions.crypt('123456', encrypted_password)`)).n, 5)
  assert.equal((await one(`select count(*)::int n from auth.users a where not exists (select 1 from auth.identities i where i.user_id = a.id)`)).n, 5)
  assert.equal((await one(`select count(*)::int n from public.users where role = 'rescuer'`)).n, 3)
  assert.equal((await one(`select count(*)::int n from public.household_members`)).n, 1 + 8)
  assert.deepEqual((await one('select member_uids from public.rescue_units where unit_id = 2')).member_uids, ['aaaa0001-0000-4000-8000-000000000002'])
  assert.equal((await one('select center_name from public.evacuation_centers where center_id = 11')).center_name, 'Buagsong Covered Court')
  // Running it again changes nothing.
  await db.exec(await migration('20261019_05_resident_signup_and_test_logins.sql'))
  assert.equal((await one(`select count(*)::int n from public.household_members`)).n, 1 + 8)

  // Registration as the Edge Function does it (service role, after creating the login).
  const newUid = uid(600)
  await db.query(`insert into auth.users(id, email) values ($1, '09995550000@resident.prioritycare.local')`, [newUid])
  const form = { f_name: 'Nena', l_name: 'Gomez', contact_no: '0999 555 0000', sex: 'female', birthdate: '1970-02-02',
    mobility_status: 'semi_ambulatory', emerg_contact_name: 'Lito Gomez', emerg_contact_no: '09995551111', barangay_id: 12,
    sitio: 'Sitio Ibabao', landmark: 'Yellow house', disability_ids: [1],
    household: { house_type: 'light', tenure: 'renter', floor_level: 'ground', unit_no: '',
      members: [{ name: 'Lito Gomez', relationship: 'Spouse', mobility: 'wheelchair', age_group: 'senior', is_pregnant: false, needs: '' }] } }
  await assert.rejects(actor(5).then(() => db.query('select public.complete_resident_registration($1,$2)', [newUid, JSON.stringify(form)])))
  await db.exec('reset role')
  const reg = (await one('select public.complete_resident_registration($1,$2) r', [newUid, JSON.stringify(form)])).r
  assert.equal(reg.email, '09995550000@resident.prioritycare.local')
  const res = await one('select barangay_id, sitio, gps_lat::float lat, mobility_status::text m from public.residents where uid = $1', [newUid])
  assert.deepEqual(res, { barangay_id: 12, sitio: 'Sitio Ibabao', lat: 10.25, m: 'semi_ambulatory' })
  await assert.rejects(db.query('select public.complete_resident_registration($1,$2)', [newUid, JSON.stringify(form)]), /already registered/)
  await db.query(`insert into auth.users(id, email) values ($1, 'dupe@x')`, [uid(601)])
  await assert.rejects(db.query('select public.complete_resident_registration($1,$2)', [uid(601), JSON.stringify(form)]), /already registered/)
  await assert.rejects(db.query('select public.complete_resident_registration($1,$2)',
    [uid(601), JSON.stringify({ ...form, contact_no: '12345' })]), /mobile number/)

  // Self-service as the new resident.
  await actor(600)
  const me = (await one('select public.get_my_profile() p')).p
  assert.equal(me.resident.barangay_name, 'Poblacion')
  assert.equal(me.household.is_head, true)
  assert.equal(me.household.members[0].mobility, 'wheelchair')
  const updated = (await one('select public.update_my_household($1) m', [JSON.stringify({ sitio: 'Sitio Tabay', unit_no: 'A',
    members: [...me.household.members, { name: 'Baby Gomez', relationship: 'Grandchild', age_group: 'infant', mobility: 'assisted' }] })])).m
  assert.equal(updated.length, 2)
  assert.equal(updated[0].member_id, me.household.members[0].member_id)
  await assert.rejects(db.query(`select public.set_my_house_photo('${uid(5)}/x.jpg')`))
  await db.query(`select public.set_my_house_photo('${newUid}/front.jpg')`)
  const doc = (await one(`select public.submit_my_verification_document(2, '${newUid}/id.jpg', 'PSN-123') d`)).d
  assert.ok(doc)
  await assert.rejects(db.query(`insert into public.verification_documents(uid,type_id,file_url,review_status) values ($1,2,'x','approved')`, [newUid]))
  // Another resident's household cannot be edited through update_my_household.
  await actor(3)
  await assert.rejects(db.query(`select public.update_my_household('{}')`), /household head/)
  await db.exec('reset role')

  // Step 3: SOS, hazards, member and walk-in evacuation.
  // Live database: evacuation_records has RLS and table grants from earlier migrations.
  await db.exec(`alter table public.evacuation_records enable row level security;
    grant select, insert, update, delete on public.evacuation_records to authenticated;`)
  await db.exec(await migration('20261019_06_sos_hazards_evacuation.sql'))
  const JUAN = '11111111-1111-4111-a111-111111111111', MARIA = '22222222-2222-4222-a222-222222222222'
  const PEDRO = '33333333-3333-4333-a333-333333333333', RICO = 'aaaa0001-0000-4000-8000-000000000001'
  async function as(id) {
    await db.exec('reset role')
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id])
    await db.exec('set role authenticated')
  }
  const mySos = async () => (await one('select public.get_my_sos() s')).s
  await as(JUAN)
  const sos = (await one(`select public.raise_sos('flood', null, null, 'Water at the door') s`)).s
  assert.equal(sos.app_status, 'TRANSMITTED')
  assert.equal(sos.alert_level, 3) // pregnant spouse and an infant
  assert.equal(sos.headcount, 4)
  assert.equal((await one(`select public.raise_sos('FIRE', null, null, '') s`)).s.alert_id, sos.alert_id) // still one alert
  await assert.rejects(db.query(`select public.raise_sos('BOMB', null, null, '')`))

  // Who can see the alert.
  // uid(4) (also Alegria) kept an active alert from the step 2 fixtures.
  for (const [id, n] of [[PEDRO, 0], [uid(1), 2], [RICO, 2], [JUAN, 1]]) {
    await as(id)
    assert.equal((await one('select count(*)::int n from public.sos_alerts')).n, n, `sos visible to ${id}`)
  }
  // The barangay admin dispatches the Alegria team from the intake list.
  await as(uid(1))
  const board = (await one('select public.get_dispatch_board() d')).d
  assert.ok(board.intake_sos.some(a => a.alert_id === sos.alert_id))
  const ticket = (await one(`select public.create_dispatch_ticket(1, null, $1, 'Flood SOS', 'sos', $2, 'critical',
    null, null, '', '', '{boat}', 1) id`, [JUAN, sos.alert_id])).id
  await as(JUAN)
  let mine = await mySos()
  assert.equal(mine.app_status, 'DISPATCHED')
  assert.equal(mine.ticket.unit_name, 'Alegria Rescue 1')

  // The rescuer's feed has the household at the door.
  await as(RICO)
  const feed = (await one('select public.get_rescuer_feed() f')).f
  assert.equal(feed.tickets.length, 1)
  assert.equal(feed.tickets[0].resident.name, 'Juan Dela Cruz')
  assert.equal(feed.tickets[0].sos.alert_type, 'FLOOD')
  assert.equal(feed.tickets[0].resident.household.people.length, 4)
  assert.equal(feed.active_sos.length, 2)
  await db.query(`select public.update_dispatch_status($1, 'acknowledged', '')`, [ticket])
  const bea = (await one(`select member_id from public.household_members where full_name = 'Bea Dela Cruz'`)).member_id
  await db.query(`select public.record_evacuation(null, $1, 10, 'safely_evacuated')`, [bea])
  await assert.rejects(db.query(`select public.record_evacuation($1, $2, 10, 'safely_evacuated')`, [JUAN, bea]))
  await as(JUAN)
  mine = await mySos()
  assert.equal(mine.app_status, 'EVACUATED')
  assert.equal(mine.shelter, 'School')
  await as(RICO)
  await db.query(`select public.update_dispatch_status($1, 'resolved', 'Household moved to the school')`, [ticket])
  await as(JUAN)
  assert.equal((await mySos()).status, 'resolved')

  // Cancelling an SOS also cancels a ticket nobody has acknowledged.
  await as(MARIA)
  const msos = (await one(`select public.raise_sos('MEDICAL', 10.26, 123.94, '') s`)).s
  await as(uid(2))
  const mticket = (await one(`select public.create_dispatch_ticket(2, null, $1, 'Medical SOS', 'sos', $2, 'high',
    null, null, '', '', '{}', 1) id`, [MARIA, msos.alert_id])).id
  await as(MARIA)
  await assert.rejects(db.query(`select public.cancel_my_sos('bored')`))
  assert.equal((await one(`select public.cancel_my_sos('accidental') s`)).s.app_status, 'CANCELLED')
  await db.exec('reset role')
  assert.equal((await one('select status from public.dispatch_tickets where ticket_id = $1', [mticket])).status, 'cancelled')

  // Hazards: resident reports stay unverified until a rescuer confirms.
  await as(MARIA)
  await assert.rejects(db.query(`select public.report_hazard('WIRE', 'x', 10.26, 123.94, null, '${uid(5)}/p.jpg')`))
  const hz = (await one(`select public.report_hazard('wire', 'Live wire on the road', 10.26, 123.94, null, null) id`)).id
  assert.equal((await one('select barangay_id, status from public.hazard_reports where hazard_id = $1', [hz])).status, 'unverified')
  await as(PEDRO)
  assert.equal((await one('select count(*)::int n from public.hazard_reports')).n, 0)
  await assert.rejects(db.query(`select public.review_hazard($1, 'confirm', '')`, [hz]))
  await as(RICO)
  await assert.rejects(db.query(`select public.review_hazard($1, 'dismiss', '')`, [hz]), /Say why/)
  await db.query(`select public.review_hazard($1, 'confirm', '')`, [hz])
  const own = (await one(`select public.report_hazard('BLOCK', 'Fallen tree', 10.255, 123.957, 1, null) id`)).id
  assert.equal((await one('select status from public.hazard_reports where hazard_id = $1', [own])).status, 'confirmed')
  await as(PEDRO)
  assert.equal((await one('select public.get_public_map() m')).m.hazards.length, 2)
  assert.equal((await one('select barangay_id from public.hazard_reports where hazard_id = $1', [hz])).barangay_id, 2) // nearest centre

  // Walk-ins count toward occupancy; a centre with people in it cannot close.
  await as(RICO)
  await db.query(`select public.admit_walk_in(10, 'Lopez family', 3, 'Sitio Bitoon', 5, '1 senior')`)
  await as(PEDRO)
  await assert.rejects(db.query(`select public.admit_walk_in(10, 'X', 3, '', 1, '')`))
  assert.equal((await one('select public.get_public_map() m')).m.centers.find(c => c.center_id === 10).occupied, 6)
  await as(uid(2))
  await assert.rejects(db.query(`select public.change_evacuation_facility_status(10, 'closed', 'test', 'active')`), /Cannot close/)
  assert.ok((await one(`select public.get_operational_timeline(now() - interval '1 day', now() + interval '1 day') t`)).t.events
    .some(e => e.category === 'sos'))
  // The admin of Alegria sees the member's record, not other barangays' walk-ins.
  await as(uid(1))
  assert.deepEqual((await all('select member_id from public.evacuation_records where resident_uid is null')).map(r => r.member_id), [bea])

  // A household flags a member missing, then safe.
  const miko = (await one(`select member_id from public.household_members where full_name = 'Miko Dela Cruz'`)).member_id
  await as(PEDRO)
  await assert.rejects(db.query('select public.set_my_member_missing($1, true, $2)', [miko, '']), /not in your household/)
  await as(JUAN)
  await db.query('select public.set_my_member_missing($1, true, $2)', [miko, 'Went to check the boat'])
  await assert.rejects(db.query('select public.set_my_member_missing($1, true, $2)', [miko, '']), /already reported/)
  let status = (await one('select public.get_my_household_status() s')).s
  assert.equal(status.people.length, 4)
  assert.equal(status.people.find(p => p.member_id === miko).missing, true)
  assert.equal(status.people.find(p => p.member_id === bea).evac_status, 'safely_evacuated')
  await as(uid(1))
  assert.equal((await one('select public.get_dispatch_board() d')).d.intake_missing.length, 1)
  await as(JUAN)
  await db.query('select public.set_my_member_missing($1, false, $2)', [miko, ''])
  status = (await one('select public.get_my_household_status() s')).s
  assert.equal(status.people.find(p => p.member_id === miko).missing, false)
  await db.exec('reset role')
  assert.deepEqual((await one(`select array_agg(code order by type_id) c from public.document_types`)).c, ['philsys', 'voters', '4ps'])
  console.log('households-members-migration: ok')
} finally {
  await db.close()
}
