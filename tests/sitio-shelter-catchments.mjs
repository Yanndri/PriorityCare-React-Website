// SQL test for 20261017_sitio_shelter_catchments.sql against an isolated synthetic database.
// Usage: node tests/sitio-shelter-catchments.mjs <PGlite-module-path-or-file-URL>
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
    create table public.sitios(sitio_id integer primary key,sitio_name text);
    create table public.users(uid uuid primary key,role text,account_status text,assigned_sitio_id integer,f_name text,l_name text);
    create table public.residents(uid uuid primary key,sitio_id integer,gps_lat numeric,gps_long numeric);
    create table public.households(household_id uuid primary key,sitio_id integer,household_members jsonb);
    create table public.evacuation_centers(center_id integer primary key,center_name text,status text,capacity integer,gps_lat numeric,gps_long numeric);
    insert into public.sitios values(1,'Sitio One'),(2,'Sitio Two'),(3,'Sitio Three');
    insert into public.evacuation_centers values(10,'School','active',50,10.30,123.90),(11,'Court','active',null,10.31,123.91),
      (12,'Hall','active',20,10.32,123.92),(13,'Old Gym','closed',100,10.33,123.93),(14,'Church','active',30,10.34,123.94);
    grant usage on schema public,auth to authenticated,anon;`)
  for (const [n, role, status, sitio, f] of [[1,'admin','active',1,'Ana'],[2,'admin','active',2,'Ben'],[4,'admin','suspended',1,'Sus'],[5,'super_admin','active',null,'Sue'],[20,'resident','active',null,'Res']]) {
    await db.query('insert into auth.users values($1)', [uid(n)])
    await db.query('insert into public.users values($1,$2,$3,$4,$5,$6)', [uid(n), role, status, sitio, f, 'X'])
  }
  await db.exec(`insert into public.residents values
      ('${uid(101)}',1,10.30,123.90),('${uid(102)}',1,10.32,123.92),('${uid(103)}',1,0,0),('${uid(104)}',1,null,null),
      ('${uid(201)}',2,10.40,124.00);
    insert into public.households values('${uid(800)}',1,'[{"name":"Baby"},{"name":"Lolo"}]'),('${uid(801)}',2,'[]');`)
  await db.exec(await migration('20261014_disaster_events.sql'))
  const sql = await migration('20261017_sitio_shelter_catchments.sql')
  await db.exec(sql); await db.exec(sql)

  async function actor(n, role = 'authenticated') {
    await db.exec('reset role')
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [n ? uid(n) : ''])
    await db.exec(`set role ${role}`)
  }
  const get = async () => (await db.query('select public.get_shelter_assignments() as d')).rows[0].d
  const set = (sitio, primary, alts = [], note = '') =>
    db.query('select public.set_sitio_shelters($1,$2,$3::int[],$4)', [sitio, primary, `{${alts.join(',')}}`, note])

  await actor(1)
  let d = await get()
  const s1 = d.sitios.find(s => s.sitio_id === 1)
  assert.equal(s1.editable, true)
  assert.equal(d.sitios.find(s => s.sitio_id === 2).editable, false)
  assert.equal(s1.residents, 4)
  assert.equal(s1.dependents, 2)
  assert.ok(Math.abs(Number(s1.centroid_lat) - 10.31) < 1e-9) // 0,0 and null excluded
  assert.equal(s1.primary_center_id, null)
  assert.equal(d.centers.length, 5)

  await set(1, 10, [11, 12], ' Purok 1–3 to School ')
  d = await get()
  const plan = d.sitios.find(s => s.sitio_id === 1)
  assert.equal(plan.primary_center_id, 10)
  assert.deepEqual(plan.alternate_center_ids, [11, 12])
  assert.equal(plan.note, 'Purok 1–3 to School')
  assert.equal(plan.updated_by_name, 'Ana X')
  const school = d.centers.find(c => c.center_id === 10)
  assert.deepEqual(school.primary_for, [1])
  assert.equal(Number(school.planned_population), 6) // 4 residents + 2 dependents

  // Validation.
  for (const [args, re] of [
    [[2, 10], /administrator access/], [[1, 13], /closed/], [[1, 10, [10]], /only once/], [[1, 10, [11, 11]], /only once/],
    [[1, 10, [11, 12, 14, 12]], /at most 3|only once/], [[1, null, [11]], /primary shelter before/], [[1, 99], /does not exist/],
    [[1, 10, [99]], /does not exist/], [[9, 10], /administrator access|valid sitio/], [[1, 10, [], 'x'.repeat(501)], /500/]]) {
    await assert.rejects(set(...args), re)
  }
  // Closed centers are allowed as alternates but not as primary; clearing works.
  await set(1, 14, [13])
  await set(1, null, [])
  assert.equal((await get()).sitios.find(s => s.sitio_id === 1).primary_center_id, null)
  await set(1, 10, [])

  await actor(2)
  await set(2, 10)
  assert.equal(Number((await get()).centers.find(c => c.center_id === 10).planned_population), 7)
  await actor(5)
  await set(3, 12)
  assert.equal((await get()).can_edit_all, true)
  for (const n of [4, 20]) { await actor(n); await assert.rejects(get(), /administrator access/) }
  await actor(null, 'anon'); await assert.rejects(get(), /permission denied/)
  await actor(1)
  await assert.rejects(db.query('select * from public.sitio_shelter_plans'), /permission denied/)
  await assert.rejects(db.query("update public.sitio_shelter_plans set primary_center_id = 11"), /permission denied/)
  await db.exec('reset role')
  const audit = (await db.query('select sitio_id, previous is null as first from public.sitio_shelter_plan_audit order by audit_id')).rows
  assert.deepEqual(audit.map(a => [a.sitio_id, a.first]), [[1, true], [1, false], [1, false], [1, false], [2, true], [3, true]])
  console.log('sitio-shelter-catchments SQL tests passed')
} finally {
  await db.close()
}
