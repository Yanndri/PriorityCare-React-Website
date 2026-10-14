import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const { PGlite } = await import(process.argv[2] ?? '@electric-sql/pglite')
const db=await PGlite.create()
const uid=(n)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
try {
  await db.exec(`create role anon;create role authenticated;create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.users(uid uuid primary key,role text,account_status text);
    create type public.center_type as enum ('school','covered_court','barangay_hall','church','other');
    create type public.evac_status_type as enum ('pending','in_transit','safely_evacuated','failed');
    create table public.evacuation_centers(center_id serial primary key,center_name text,center_type center_type,gps_lat numeric,gps_long numeric);
    create table public.evacuation_records(record_id uuid primary key,resident_uid uuid,evac_center_id integer references public.evacuation_centers(center_id),evac_status evac_status_type,logged_at timestamptz);
    grant usage on schema public,auth to authenticated,anon;
  `)
  for (const [n,role,status] of [[1,'admin','active'],[2,'resident','active'],[3,'admin','suspended']]) {
    await db.query('insert into auth.users values($1)',[uid(n)])
    await db.query('insert into public.users values($1,$2,$3)',[uid(n),role,status])
  }
  await db.exec(await readFile(new URL('../supabase/migrations/20261014_facility_registration.sql',import.meta.url),'utf8'))
  const migration=await readFile(new URL('../supabase/migrations/20261014_facility_lifecycle.sql',import.meta.url),'utf8')
  await db.exec(migration);await db.exec(migration)
  async function actor(n,role='authenticated') {
    await db.exec('reset role')
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[n ? uid(n) : ''])
    await db.exec(`set role ${role}`)
  }
  const change=(id,status,reason='Review complete',expected=status==='closed'?'active':'closed')=>db.query('select public.change_evacuation_facility_status($1,$2,$3,$4)',[id,status,reason,expected])
  await actor(1)
  const id=(await db.query("select public.register_evacuation_facility('Test','school',10,123,20) as id")).rows[0].id
  await change(id,'closed','Disaster response complete')
  const catalog=(await db.query('select public.get_evacuation_facility_catalog() as result')).rows[0].result
  assert.equal(catalog[0].status,'closed');assert.ok(catalog[0].closed_at)
  assert.equal(catalog[0].closure_reason,'Disaster response complete')
  await assert.rejects(change(id,'closed'),/status changed/)
  await db.exec('reset role')
  for (const status of ['pending','in_transit','safely_evacuated']) {
    await assert.rejects(db.query('insert into public.evacuation_records values($1,$2,$3,$4,now())',[uid(10),uid(20),id,status]),/center is closed/)
  }
  await actor(1);await change(id,'active','Inspected and reopened')
  await assert.rejects(change(id,'closed',' '),/reason/)
  for (const [i,status] of ['pending','in_transit','safely_evacuated'].entries()) {
    await db.exec('reset role')
    await db.query('insert into public.evacuation_records values($1,$2,$3,$4,$5)',[uid(30+i),uid(20),id,status,`2026-10-${14+i}T00:00:00Z`])
    await actor(1);await assert.rejects(change(id,'closed'),/Cannot close/)
  }
  await db.exec('reset role')
  await db.query("insert into public.evacuation_centers(center_name,center_type,gps_lat,gps_long,capacity) values('Other','school',10,123,20)")
  await db.query("insert into public.evacuation_records values($1,$2,2,'safely_evacuated','2026-10-20T00:00:00Z')",[uid(40),uid(20)])
  await actor(1);await change(id,'closed','Transferred to another center')
  for (const n of [2,3,null]) {await actor(n);await assert.rejects(change(id,'active'),/administrator access/)}
  await actor(null,'anon');await assert.rejects(change(id,'active'),/permission denied/)
  await db.exec('reset role')
  assert.equal((await db.query('select count(*)::integer as n from public.facility_status_audit')).rows[0].n,3)
  assert.equal((await db.query('select count(*)::integer as n from public.evacuation_records')).rows[0].n,4)
  await db.query('update public.evacuation_centers set capacity=null where center_id=$1',[id])
  await actor(1);await assert.rejects(change(id,'active'),/safe capacity/)
  console.log('PASS: close/reopen, metadata, history preservation, incoming/occupied guards, transfer resolution, direct admission guard, audit, stale status, authorization')
} finally {await db.close()}
