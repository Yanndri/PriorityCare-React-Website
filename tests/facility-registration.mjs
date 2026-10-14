import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { validateCapacity, validateFacility } from '../src/utils/facility.ts'
const { PGlite } = await import(process.argv[2] ?? '@electric-sql/pglite')
const db = await PGlite.create()
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
try {
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.users(uid uuid primary key,role text,account_status text);
    create type public.center_type as enum ('school','covered_court','barangay_hall','church','other');
    create type public.evac_status_type as enum ('pending','in_transit','safely_evacuated','failed');
    create table public.evacuation_centers(center_id serial primary key,center_name varchar(100) not null,
      center_type public.center_type not null,gps_lat numeric not null,gps_long numeric not null);
    create table public.evacuation_records(record_id uuid primary key,resident_uid uuid not null,
      evac_center_id integer references public.evacuation_centers(center_id),evac_status public.evac_status_type,logged_at timestamptz);
    grant usage on schema public,auth to authenticated,anon;
    insert into public.evacuation_centers(center_name,center_type,gps_lat,gps_long) values('Existing','school',10,123);
  `)
  for (const [n,role,status] of [[1,'admin','active'],[2,'super_admin','active'],[3,'resident','active'],[4,'admin','suspended']]) {
    await db.query('insert into auth.users values($1)',[uid(n)])
    await db.query('insert into public.users values($1,$2,$3)',[uid(n),role,status])
  }
  const migration = await readFile(new URL('../supabase/migrations/20261014_facility_registration.sql',import.meta.url),'utf8')
  await db.exec(migration); await db.exec(migration)
  assert.equal((await db.query('select capacity from public.evacuation_centers where center_id=1')).rows[0].capacity,null)
  async function actor(n,role='authenticated') {
    await db.exec('reset role')
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[n ? uid(n) : ''])
    await db.exec(`set role ${role}`)
  }
  const register = (name='New',type='school',lat=10,long=123,cap=20) => db.query('select public.register_evacuation_facility($1,$2,$3,$4,$5) as id',[name,type,lat,long,cap])
  const capacity = (id,cap,expected) => db.query('select public.set_evacuation_facility_capacity($1,$2,$3)',[id,cap,expected])
  await actor(1)
  const id = (await register()).rows[0].id
  await assert.rejects(register(' new '),/already registered/)
  await assert.rejects(register('Invalid','bad'),/Invalid facility type/)
  await assert.rejects(register('Invalid','school',91),/Invalid GPS/)
  await assert.rejects(register('Invalid','school',10,123,0),/Capacity/)
  await capacity(id,30,20)
  await assert.rejects(capacity(id,40,20),/another administrator/)
  await capacity(1,5,null)
  await db.exec('reset role')
  // Latest records: resident 10 transferred to the new facility; resident 11 failed later.
  for (const [record,resident,center,status,day] of [[10,10,1,'safely_evacuated',1],[11,10,id,'safely_evacuated',2],
    [12,11,id,'safely_evacuated',1],[13,11,id,'failed',2],[14,12,id,'safely_evacuated',2]]) {
    await db.query('insert into public.evacuation_records values($1,$2,$3,$4,$5)',[uid(record),uid(resident),center,status,`2026-10-0${day}T00:00:00Z`])
  }
  await actor(1)
  const catalog = (await db.query('select public.get_evacuation_facility_catalog() as result')).rows[0].result
  assert.equal(catalog.find((row)=>row.center_id===id).occupied,2)
  assert.equal(catalog.find((row)=>row.center_id===1).occupied,0)
  await assert.rejects(capacity(id,1,30),/below the current recorded occupancy/)
  for (const n of [3,4,null]) {
    await actor(n)
    await assert.rejects(register(),/administrator access/)
    await assert.rejects(capacity(id,50,30),/administrator access/)
  }
  await actor(null,'anon')
  await assert.rejects(register(),/permission denied/)
  await actor(2)
  await capacity(id,2,30)
  await db.exec('reset role')
  assert.equal((await db.query('select count(*)::integer as n from public.facility_capacity_audit where center_id=$1',[id])).rows[0].n,3)
  assert.equal((await db.query('select capacity from public.evacuation_centers where center_id=$1',[id])).rows[0].capacity,2)
  assert.equal(validateFacility({name:'Test',type:'school',latitude:0,longitude:0,capacity:1}),'')
  for (const cap of [0,-1,1.5,NaN,Infinity,1000001]) assert.ok(validateCapacity(cap))
  console.log('PASS: registration, legacy unknown capacity, duplicates, validation, capacity edits, stale saves, global latest-record occupancy, audit, permissions')
} finally { await db.close() }
