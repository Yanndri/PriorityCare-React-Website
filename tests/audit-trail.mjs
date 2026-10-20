// SQL test for 20261014_operational_audit_trail.sql against an isolated synthetic database.
// Usage: node tests/audit-trail.mjs <PGlite-module-path-or-file-URL>
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
    create table public.evacuation_centers(center_id integer primary key,center_name text);
    create table public.evacuation_records(record_id uuid primary key,resident_uid uuid references public.residents(uid),
      rescuer_uid uuid,evac_center_id integer,evac_status text,evacuated_at timestamptz,logged_at timestamptz);
    create table public.facility_status_audit(audit_id bigint generated always as identity,center_id integer,old_status text,new_status text,reason text,changed_by uuid,changed_at timestamptz);
    create table public.facility_capacity_audit(audit_id bigint generated always as identity,center_id integer,old_capacity integer,new_capacity integer,changed_by uuid,changed_at timestamptz);
    create table public.document_types(type_id integer primary key,type_name text);
    create table public.verification_documents(doc_id integer primary key,uid uuid,type_id integer,file_url text,review_status text,
      uploaded_at timestamptz,reviewed_by uuid,reviewed_at timestamptz,rejection_reason text);
    create table public.sos_alerts(alert_id uuid primary key,resident_uid varchar,alert_level integer,alert_type varchar,status varchar,created_at timestamptz);
    insert into public.barangays values(1,'Barangay One'),(2,'Barangay Two');
    insert into public.evacuation_centers values(10,'Central School');
    insert into public.document_types values(1,'Barangay ID');
    grant usage on schema public,auth to authenticated,anon;`)
  for (const [n, role, status, barangay, f, l] of [
    [1,'admin','active',1,'Ana','Admin'],[2,'admin','active',2,'Ben','Admin'],[4,'admin','suspended',1,'Sus','P'],
    [5,'super_admin','active',null,'Sue','Per'],[7,'rescuer','active',null,'Rico','Rescuer'],
    [20,'resident','active',null,'Juan','Dela Cruz'],[30,'resident','active',null,'Liza','Gomez']]) {
    await db.query('insert into auth.users values($1)', [uid(n)])
    await db.query('insert into public.users values($1,$2,$3,$4,$5,null,$6)', [uid(n), role, status, barangay, f, l])
  }
  await db.exec(`insert into public.residents values('${uid(20)}',1,'male','1990-01-01'),('${uid(30)}',2,'female','1990-01-01');
    insert into public.evacuation_records values
      ('${uid(901)}','${uid(20)}','${uid(7)}',null,'pending',null,'2026-10-14T01:00:00Z'),
      ('${uid(902)}','${uid(20)}','${uid(7)}',10,'safely_evacuated','2026-10-14T02:00:00Z','2026-10-14T02:00:00Z'),
      ('${uid(903)}','${uid(30)}',null,null,'failed',null,'2026-10-14T02:30:00Z');
    insert into public.facility_status_audit(center_id,old_status,new_status,reason,changed_by,changed_at)
      values(10,'active','closed','Flooded','${uid(1)}','2026-10-14T03:00:00Z');
    insert into public.facility_capacity_audit(center_id,old_capacity,new_capacity,changed_by,changed_at)
      values(10,null,150,'${uid(1)}','2026-10-14T00:30:00Z');
    insert into public.verification_documents values
      (1,'${uid(20)}',1,'x','approved','2026-10-13T23:00:00Z','${uid(1)}','2026-10-14T00:10:00Z',null),
      (2,'${uid(30)}',1,'x','rejected','2026-10-13T23:30:00Z','${uid(2)}','2026-10-14T00:20:00Z','Blurry');
    insert into public.sos_alerts values('${uid(950)}','${uid(20)}',3,'medical','active','2026-10-14T00:50:00Z'),
      ('${uid(951)}','not-a-uuid',1,'other','active','2026-10-14T00:55:00Z');`)
  await db.exec(await migration('20261014_disaster_events.sql'))
  await db.exec(await migration('20261014_missing_person_reconciliation.sql'))
  const sql = await migration('20261014_operational_audit_trail.sql')
  await db.exec(sql); await db.exec(sql)

  async function actor(n, role = 'authenticated') {
    await db.exec('reset role')
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [n ? uid(n) : ''])
    await db.exec(`set role ${role}`)
  }
  const timeline = async (from = '2026-10-13T00:00:00Z', to = '2026-10-15T00:00:00Z') =>
    (await db.query('select public.get_operational_timeline($1,$2) as data', [from, to])).rows[0].data

  // Signed-in admin actions go through the trigger with their uid.
  await actor(1)
  await db.query("select public.declare_disaster_event(1,'Flood','flood','Riverside','2026-10-14T00:00:00Z','', null, null)")
  const reportId = (await db.query("select public.file_missing_person_report(1,null,$1,'Juan Dela Cruz','male',36,'River',null,'Sister','','') as id", [uid(20)])).rows[0].id
  await db.query("select public.mark_missing_person_found($1,$2,'')", [reportId, uid(20)])

  // Record edits by a signed-in user and by the service role are captured from now on.
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid(1)])
  await db.exec(`update public.evacuation_records set evac_center_id = 10 where record_id = '${uid(903)}'`)
  await db.exec(`update public.evacuation_records set evac_center_id = 10 where record_id = '${uid(903)}'`) // no-op: not logged
  await db.query("select set_config('request.jwt.claim.sub','',false)")
  await db.exec(`insert into public.evacuation_records values('${uid(904)}','${uid(20)}',null,10,'in_transit',null,'2026-10-14T04:00:00Z')`)
  await db.exec(`delete from public.evacuation_records where record_id = '${uid(904)}'`)
  const audit = (await db.query('select action, actor_uid, record_id from public.evacuation_record_audit order by audit_id')).rows
  assert.deepEqual(audit.map(a => [a.action, a.actor_uid]), [['UPDATE', uid(1)], ['INSERT', null], ['DELETE', null]])

  await actor(1)
  const t1 = await timeline()
  assert.equal(t1.scope, 'Barangay One')
  const kinds = t1.events.map(e => `${e.category}:${e.action}`)
  // Barangay 1 admin: Juan's records, facility-wide center changes, own event/report, Juan's document + SOS. Not Liza (barangay 2).
  assert.ok(!t1.events.some(e => e.subject === 'Liza Gomez'))
  assert.equal(t1.events.filter(e => e.category === 'evacuation').length, 2)
  const evac = t1.events.filter(e => e.category === 'evacuation')
  assert.deepEqual(evac.map(e => [e.from_value, e.to_value]), [[null, 'pending'], ['pending', 'safely_evacuated']])
  assert.equal(evac[1].actor_name, 'Rico Rescuer')
  assert.match(evac[1].details, /Center: Central School/)
  assert.match(evac[1].details, /Entered by: not recorded/)
  for (const k of ['facility:Center status changed', 'facility:Center capacity changed', 'disaster_event:Disaster event declared',
    'missing_person:Missing-person report filed', 'missing_person:Missing person marked found',
    'verification:Verification document uploaded', 'verification:Verification document reviewed', 'sos:SOS alert raised',
    'evacuation_change:Evacuation record deleted']) assert.ok(kinds.includes(k), k)
  assert.ok(!kinds.includes('evacuation_change:Evacuation record edited')) // that edit was for Liza (barangay 2)
  const del = t1.events.find(e => e.action === 'Evacuation record deleted')
  assert.equal(del.from_value, 'in_transit')
  assert.match(del.details, /no signed-in user/)
  const sorted = t1.events.map(e => e.occurred_at)
  assert.deepEqual(sorted, [...sorted].sort((a, b) => Date.parse(a) - Date.parse(b)))
  assert.equal(t1.events.find(e => e.action === 'Verification document reviewed').actor_name, 'Ana Admin')

  // Window filter.
  const narrow = await timeline('2026-10-14T01:30:00Z', '2026-10-14T02:15:00Z')
  assert.deepEqual(narrow.events.map(e => e.action), ['Evacuation status logged'])

  await actor(2)
  const t2 = await timeline()
  assert.ok(t2.events.some(e => e.action === 'Evacuation record edited' && e.subject === 'Liza Gomez' && /evac_center_id/.test(e.details)))
  assert.ok(t2.events.some(e => e.action === 'Verification document reviewed' && /Blurry/.test(e.details)))
  assert.ok(!t2.events.some(e => e.subject === 'Juan Dela Cruz'))
  assert.ok(t2.events.some(e => e.category === 'facility'))
  await actor(5)
  const t5 = await timeline()
  assert.equal(t5.scope, 'All barangays')
  assert.ok(t5.events.length > t1.events.length)

  await actor(1)
  for (const [from, to] of [['2026-10-15T00:00:00Z', '2026-10-14T00:00:00Z'], ['2024-01-01T00:00:00Z', '2026-01-01T00:00:00Z'], [null, '2026-10-14T00:00:00Z']]) {
    await assert.rejects(timeline(from, to))
  }
  for (const n of [4, 7, 20]) { await actor(n); await assert.rejects(timeline(), /administrator access/) }
  await actor(null, 'anon')
  await assert.rejects(timeline(), /permission denied/)
  await actor(1)
  await assert.rejects(db.query('select * from public.evacuation_record_audit'), /permission denied/)
  await assert.rejects(db.query('select public.log_evacuation_record_change()'), /permission denied/)
  console.log('audit-trail SQL tests passed')
} finally {
  await db.close()
}
