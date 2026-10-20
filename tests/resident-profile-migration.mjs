// Isolated PostgreSQL integration checks; no network or Supabase credentials.
// Install @electric-sql/pglite in a temporary directory, then pass its dist/index.js file URL.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const { PGlite } = await import(process.argv[2] ?? '@electric-sql/pglite')
const db = await PGlite.create()
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
try {
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create type public.sex_type as enum ('male','female');
    create type public.mobility_type as enum ('ambulatory','semi_ambulatory','non_ambulatory');
    create table public.barangays(barangay_id integer primary key,barangay_name text);
    create table public.users(uid uuid primary key, role text, account_status text,
      assigned_barangay_id integer, f_name text not null,m_name text,l_name text not null,
      contact_no text not null, is_verified boolean default true);
    create table public.residents(uid uuid primary key references public.users(uid),
      barangay_id integer references public.barangays(barangay_id), sex sex_type not null,
      birthdate date not null, mobility_status mobility_type not null,
      emerg_contact_name text not null,emerg_contact_no text not null,
      gps_lat numeric not null,gps_long numeric not null);
    create table public.disability_types(disability_id integer primary key,disability_name text);
    create table public.resident_disabilities(resident_uid uuid references public.residents(uid),
      disability_id integer references public.disability_types(disability_id),primary key(resident_uid,disability_id));
    insert into public.barangays values (1,'Barangay 1'),(2,'Barangay 2');
    insert into public.disability_types values (1,'Visual'),(2,'Mobility');
    grant usage on schema public,auth to authenticated;
    grant select on public.users,public.residents to authenticated;
  `)
  for (let n = 1; n <= 6; n++) {
    await db.query('insert into auth.users values ($1)', [uid(n)])
    await db.query(`insert into public.users(uid,role,account_status,assigned_barangay_id,f_name,l_name,contact_no)
      values($1,$2,$3,$4,'Test','Resident','09170000000')`,
      [uid(n), n <= 3 ? 'admin' : 'resident', n === 3 ? 'suspended' : 'active', n === 2 ? 2 : 1])
    if (n >= 4) await db.query(`insert into public.residents values
      ($1,$2,'male','1990-06-15','ambulatory','Contact','09170000001',10.3,123.9)`, [uid(n), n === 6 ? 2 : 1])
  }
  const migration = await readFile(new URL('../supabase/migrations/20261014_resident_profile_editing.sql', import.meta.url), 'utf8')
  await db.exec(migration)
  await db.exec(migration) // repeat application must be safe
  async function actor(n) {
    await db.exec('reset role')
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [n ? uid(n) : ''])
    await db.exec('set role authenticated')
  }
  async function load(n) {
    return (await db.query('select public.get_resident_edit_profile($1) as result', [uid(n)])).rows[0].result
  }
  const save = (n, profile) => db.query('select public.update_resident_demographics($1,$2::jsonb)', [uid(n), JSON.stringify(profile)])
  await actor(1)
  let initial = await load(4)
  const first = { ...initial.profile, f_name: 'Updated', household_name: 'Shared household',
    disability_ids: [1,2], household_members: [{ name: 'Dependent', relationship: 'Child',
      birthdate: '2020-01-01', sex: 'female', is_pregnant: false, needs: 'Walk assistance' }] }
  await save(4, first)
  const head = await load(4)
  assert.equal(head.profile.f_name, 'Updated')
  assert.equal(head.registered_members[0].is_head, true)
  assert.equal(head.profile.birthdate, '1990-06-15')
  assert.deepEqual(head.profile.disability_ids, [1,2])
  assert.equal(head.profile.household_members.length, 1)
  assert.ok(head.profile.household_id)
  await assert.rejects(save(4, { ...head.profile, revision: null }), /edited by another/)
  const second = (await load(5)).profile
  await save(5, { ...second, household_id: head.profile.household_id,
    household_revision: head.profile.household_revision, household_members: head.profile.household_members })
  const shared = await load(4)
  assert.equal(shared.registered_members.length, 2)
  assert.equal((await load(5)).profile.household_id, shared.profile.household_id)
  await assert.rejects(save(4, head.profile), /household was edited by another/)
  await assert.rejects(save(4, { ...shared.profile, household_id: '' }), /head cannot leave/)
  await assert.rejects(load(6), /administrator access/)
  await actor(2)
  await assert.rejects(load(4), /administrator access/)
  const other = (await load(6)).profile
  await assert.rejects(save(6, { ...other, household_id: shared.profile.household_id }), /resident's barangay/)
  await actor(3)
  await assert.rejects(load(4), /administrator access/)
  await actor(4)
  await assert.rejects(load(4), /administrator access/)
  await actor(null)
  await assert.rejects(load(4), /administrator access/)
  await actor(1)
  const before = (await load(4)).profile
  await assert.rejects(save(4, { ...before, gps_lat: 91 }), /out of range/)
  await assert.rejects(save(4, { ...before, disability_ids: [99] }), /Unknown disability/)
  // Force a late failure after users/residents/disabilities have already been updated.
  await db.exec('reset role; alter table public.resident_profile_details add constraint test_failure check (vulnerability_needs <> \'FAIL_LATE\'); set role authenticated;')
  await assert.rejects(save(4, { ...before, f_name: 'Must roll back', vulnerability_needs: 'FAIL_LATE', disability_ids: [] }), /test_failure/)
  assert.deepEqual((await load(4)).profile, before)
  const flags = (await db.query('select role,is_verified from public.users where uid=$1', [uid(4)])).rows[0]
  assert.deepEqual(flags, { role: 'resident', is_verified: true })
  await actor(2)
  assert.equal((await db.query('select * from public.resident_profile_details')).rows.length, 0)
  await assert.rejects(db.query('update public.resident_profile_details set address=\'blocked\''), /permission denied/)
  await db.exec('reset role; set role anon;')
  await assert.rejects(load(4), /permission denied/)
  console.log('PASS: migration, shared accounts, head protection, exact dates, atomic rollback, stale saves, validation, role preservation, authorization and RLS')
} finally { await db.close() }
