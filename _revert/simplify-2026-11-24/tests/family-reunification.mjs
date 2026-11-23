// SQL test for 20261017_family_reunification_lookup.sql against an isolated synthetic database.
// Usage: node tests/family-reunification.mjs <PGlite-module-path-or-file-URL>
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const { PGlite } = await import(process.argv[2] ?? '@electric-sql/pglite')
const db = await PGlite.create()
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const migration = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8')
try {
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.barangays(barangay_id integer primary key,barangay_name text);
    create table public.users(uid uuid primary key,role text,account_status text,assigned_barangay_id integer,f_name text,m_name text,l_name text);
    create table public.residents(uid uuid primary key references public.users(uid),barangay_id integer,sex text,birthdate date);
    create table public.evacuation_centers(center_id integer primary key,center_name text,status text);
    create table public.evacuation_records(record_id uuid primary key,resident_uid uuid references public.residents(uid),
      rescuer_uid uuid,evac_center_id integer,evac_status text,evacuated_at timestamptz,logged_at timestamptz);
    create table public.households(household_id uuid primary key,household_name text,barangay_id integer,head_uid uuid unique,household_members jsonb);
    create table public.resident_profile_details(resident_uid uuid primary key,household_id uuid);
    insert into public.barangays values(1,'Barangay One'),(2,'Barangay Two');
    insert into public.evacuation_centers values(10,'Central School','active'),(11,'Covered Court','active');
    grant usage on schema public,auth to authenticated,anon;`)
  for (const [n, role, status, barangay, f, l] of [
    [1,'admin','active',1,'Ana','Admin'],[2,'admin','active',2,'Ben','Admin'],[4,'admin','suspended',1,'Sus','P'],
    [5,'super_admin','active',null,'Sue','Per'],[6,'admin','active',null,'No','Barangay'],
    [20,'resident','active',null,'Jose','Mercado'],[21,'resident','active',null,'Lorna','Mercado'],
    [22,'resident','active',null,'Pedro','Mercado'],[30,'resident','active',null,'Liza','Gomez'],[31,'resident','active',null,'José','Santos']]) {
    await db.query('insert into auth.users values($1)', [uid(n)])
    await db.query('insert into public.users values($1,$2,$3,$4,$5,null,$6)', [uid(n), role, status, barangay, f, l])
  }
  await db.exec(`insert into public.residents values
      ('${uid(20)}',1,'male','1958-03-12'),('${uid(21)}',1,'female','1961-07-02'),('${uid(22)}',1,'male','2010-01-01'),
      ('${uid(30)}',2,'female','1992-09-19'),('${uid(31)}',2,'male','1980-01-01');
    insert into public.households values('${uid(800)}','Mercado Household',1,'${uid(20)}',
      '[{"name":"Baby Mercado","relationship":"Granddaughter","birthdate":"2024-05-01","sex":"female"}]');
    insert into public.resident_profile_details values('${uid(21)}','${uid(800)}'),('${uid(22)}','${uid(800)}');
    insert into public.evacuation_records values
      ('${uid(901)}','${uid(20)}',null,10,'safely_evacuated','2026-10-14T02:00:00Z','2026-10-14T02:00:00Z'),
      ('${uid(902)}','${uid(21)}',null,11,'safely_evacuated','2026-10-14T03:00:00Z','2026-10-14T03:00:00Z'),
      ('${uid(903)}','${uid(22)}',null,10,'safely_evacuated','2026-10-14T01:00:00Z','2026-10-14T01:00:00Z'),
      ('${uid(904)}','${uid(22)}',null,null,'failed',null,'2026-10-14T04:00:00Z'),
      ('${uid(905)}','${uid(30)}',null,11,'safely_evacuated','2026-10-14T02:30:00Z','2026-10-14T02:30:00Z');`)
  await db.exec(await migration('20261014_disaster_events.sql'))
  await db.exec(await migration('20261014_missing_person_reconciliation.sql'))
  const sql = await migration('20261017_family_reunification_lookup.sql')
  await db.exec(sql); await db.exec(sql)

  async function actor(n, role = 'authenticated') {
    await db.exec('reset role')
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [n ? uid(n) : ''])
    await db.exec(`set role ${role}`)
  }
  const search = async (q, center = null) => (await db.query('select public.search_evacuees($1,$2) as d', [q, center])).rows[0].d
  const household = async id => (await db.query('select public.get_evacuee_household($1) as d', [id])).rows[0].d

  // Barangay 2 admin can find barangay 1 evacuees: reunification is cross-barangay.
  await actor(2)
  const r = await search('mercado')
  assert.deepEqual(r.people.map(p => p.full_name), ['Jose Mercado', 'Lorna Mercado', 'Pedro Mercado'])
  const byName = Object.fromEntries(r.people.map(p => [p.full_name, p]))
  assert.equal(byName['Jose Mercado'].center_name, 'Central School')
  assert.equal(byName['Lorna Mercado'].center_name, 'Covered Court')
  assert.equal(byName['Pedro Mercado'].latest_status, 'failed') // latest record wins
  assert.equal(byName['Pedro Mercado'].center_name, null)
  assert.equal(byName['Jose Mercado'].household_name, 'Mercado Household')
  assert.equal(byName['Lorna Mercado'].household_id, uid(800))
  assert.equal(byName['Jose Mercado'].home_barangay, 'Barangay One')
  assert.equal(typeof byName['Jose Mercado'].age, 'number')
  assert.ok(!('contact_no' in byName['Jose Mercado']))
  assert.equal(r.has_more, false)
  assert.deepEqual(r.centers.map(c => [c.center_name, c.sheltered]), [['Central School', 1], ['Covered Court', 2]])

  // Multi-word, case-insensitive; all words must match.
  assert.deepEqual((await search('  LORNA   merc ')).people.map(p => p.full_name), ['Lorna Mercado'])
  assert.equal((await search('lorna gomez')).people.length, 0)
  assert.deepEqual((await search('jose')).people.map(p => p.full_name), ['Jose Mercado', 'José Santos'])
  assert.deepEqual((await search('JOSÉ santos')).people.map(p => p.full_name), ['José Santos'])
  // Center roster without a name: only people currently sheltered there.
  assert.deepEqual((await search('', 11)).people.map(p => p.full_name), ['Liza Gomez', 'Lorna Mercado'])
  assert.deepEqual((await search('', 10)).people.map(p => p.full_name), ['Jose Mercado'])
  for (const q of ['', ' ', 'a', null, 'x'.repeat(101)]) await assert.rejects(search(q))

  // Household view: members with locations + dependents without accounts.
  const h = await household(uid(21))
  assert.equal(h.household_name, 'Mercado Household')
  assert.deepEqual(h.members.map(m => [m.full_name, m.is_head, m.center_name]),
    [['Jose Mercado', true, 'Central School'], ['Lorna Mercado', false, 'Covered Court'], ['Pedro Mercado', false, null]])
  assert.deepEqual(h.dependents.map(d => d.name), ['Baby Mercado'])
  const solo = await household(uid(30))
  assert.equal(solo.household_id, null)
  assert.deepEqual(solo.members, [])
  await assert.rejects(household(uid(999)), /not found/)

  // Open missing report shows up as a flag.
  await actor(1)
  await db.query("select public.file_missing_person_report(1,null,$1,'Pedro Mercado','male',16,'',null,'Mother','','')", [uid(22)])
  assert.equal((await search('pedro')).people[0].open_missing_report, true)

  // Access.
  await actor(5); assert.equal((await search('mercado')).people.length, 3)
  for (const n of [4, 6, 20]) { await actor(n); await assert.rejects(search('mercado'), /administrator access/) }
  await actor(null, 'anon'); await assert.rejects(search('mercado'), /permission denied/)
  await actor(1)
  await assert.rejects(db.query('select * from public.reunification_people()'), /permission denied/)
  await assert.rejects(db.query('select * from public.reunification_lookup_audit'), /permission denied/)

  // Every lookup is audited.
  await db.exec('reset role')
  const audit = (await db.query("select lookup, count(*)::int as n from public.reunification_lookup_audit group by lookup order by lookup")).rows
  assert.deepEqual(audit, [{ lookup: 'household', n: 2 }, { lookup: 'search', n: 9 }])
  console.log('family-reunification SQL tests passed')
} finally {
  await db.close()
}
