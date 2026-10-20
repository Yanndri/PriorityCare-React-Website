import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const { PGlite } = await import(process.argv[2] ?? '@electric-sql/pglite')
const db = await PGlite.create()
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
try {
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.users(uid uuid primary key,role text,account_status text,assigned_barangay_id integer);
    create table public.barangays(barangay_id integer primary key,barangay_name text);
    insert into public.barangays values(1,'Barangay One'),(2,'Barangay Two');
    grant usage on schema public,auth to authenticated,anon;`)
  for (const [n, role, status, barangay] of [[1,'admin','active',1],[2,'admin','active',2],[3,'resident','active',1],[4,'admin','suspended',1],[5,'super_admin','active',null],[6,'admin','active',null]]) {
    await db.query('insert into auth.users values($1)', [uid(n)])
    await db.query('insert into public.users values($1,$2,$3,$4)', [uid(n),role,status,barangay])
  }
  const migration = await readFile(new URL('../supabase/migrations/20261014_disaster_events.sql', import.meta.url), 'utf8')
  await db.exec(migration); await db.exec(migration)
  async function actor(n, role='authenticated') {
    await db.exec('reset role')
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [n ? uid(n) : ''])
    await db.exec(`set role ${role}`)
  }
  const declare = (overrides={}) => {
    const p = {barangay:1,name:'Riverside flood',hazard:'flood',location:'Riverside',onset:'2020-01-01T00:00:00Z',notes:'Test',lat:10.3,lng:123.9,...overrides}
    return db.query('select public.declare_disaster_event($1,$2,$3,$4,$5,$6,$7,$8) as id', Object.values(p))
  }
  const catalog = async () => (await db.query('select public.get_disaster_event_register() as data')).rows[0].data
  const resolve = (id,reason='Area inspected') => db.query('select public.resolve_disaster_event($1,$2)', [id,reason])
  await actor(1)
  const id = (await declare()).rows[0].id
  assert.equal((await catalog()).events[0].event_id, id)
  assert.equal((await catalog()).barangays.length, 1)
  await assert.rejects(declare({name:' RIVERSIDE FLOOD '}), /already exists/)
  for (const overrides of [{barangay:2},{barangay:null},{hazard:'typhoon'},{onset:'2999-01-01T00:00:00Z'},{onset:'infinity'},{lat:null,lng:123},{lat:100},{name:' '},{location:''},{notes:'x'.repeat(2001)}]) {
    await assert.rejects(declare(overrides))
  }
  for (const hazard of ['fire','earthquake','landslide']) await declare({hazard,lat:null,lng:null})
  await assert.rejects(db.query('update public.disaster_events set status=\'resolved\''), /permission denied/)
  await assert.rejects(db.query('select * from public.disaster_event_audit'), /permission denied/)
  await actor(2)
  assert.equal((await catalog()).events.length, 0)
  await assert.rejects(resolve(id), /administrator access/)
  for (const n of [3,4,6,null]) {
    await actor(n); await assert.rejects(declare(), /administrator access/)
    await assert.rejects(catalog(), /administrator access/)
    await assert.rejects(resolve(id), /administrator access/)
  }
  await actor(null,'anon'); await assert.rejects(catalog(), /permission denied/)
  await assert.rejects(declare(), /permission denied/)
  await actor(5)
  assert.equal((await catalog()).barangays.length, 2)
  await declare({barangay:2})
  assert.equal((await catalog()).events.length, 5)
  await assert.rejects(resolve(id,' '), /resolution reason/)
  await resolve(id)
  await assert.rejects(resolve(id), /already resolved/)
  await actor(1)
  const event = (await catalog()).events.find(e => e.event_id === id)
  assert.equal(event.status,'resolved'); assert.equal(event.resolved_by,uid(5))
  assert.equal(event.resolution_reason,'Area inspected'); assert.ok(event.resolved_at)
  await declare() // A later incident can reuse the name once the prior one is resolved.
  await db.exec('reset role')
  assert.equal((await db.query('select count(*)::int as n from public.disaster_event_audit')).rows[0].n, 7)
  assert.equal((await db.query('select count(*)::int as n from public.disaster_events')).rows[0].n, 6)
  console.log('PASS: four hazards, validation, duplicate guard, scope, role/status restrictions, direct-write denial, resolution, audit preservation, repeat migration')
} finally { await db.close() }
