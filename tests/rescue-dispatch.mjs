// SQL test for 20261017_rescue_dispatch_tickets.sql against an isolated synthetic database.
// Usage: node tests/rescue-dispatch.mjs <PGlite-module-path-or-file-URL>
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
    create table public.users(uid uuid primary key,role text,account_status text,assigned_barangay_id integer,f_name text,l_name text,contact_no text);
    create table public.residents(uid uuid primary key,barangay_id integer,gps_lat numeric,gps_long numeric);
    create table public.evacuation_records(record_id uuid primary key,resident_uid uuid,evac_status text,evacuated_at timestamptz,logged_at timestamptz);
    create table public.sos_alerts(alert_id uuid primary key,resident_uid varchar,alert_level integer,alert_type varchar,status varchar,created_at timestamptz default now());
    insert into public.barangays values(1,'Barangay One'),(2,'Barangay Two');
    grant usage on schema public,auth to authenticated,anon;`)
  for (const [n, role, status, barangay, f] of [[1,'admin','active',1,'Ana'],[2,'admin','active',2,'Ben'],[4,'admin','suspended',1,'Sus'],
    [5,'super_admin','active',null,'Sue'],[7,'rescuer','active',null,'Rico'],[8,'rescuer','active',null,'Rita'],[9,'rescuer','suspended',null,'Old'],
    [20,'resident','active',null,'Juan'],[30,'resident','active',null,'Liza']]) {
    await db.query('insert into auth.users values($1)', [uid(n)])
    await db.query('insert into public.users values($1,$2,$3,$4,$5,$6,$7)', [uid(n), role, status, barangay, f, 'X', `0917${n}`])
  }
  await db.exec(`insert into public.residents values('${uid(20)}',1,10.3,123.9),('${uid(30)}',2,10.4,124.0);
    insert into public.sos_alerts(alert_id,resident_uid,alert_level,alert_type,status) values
      ('${uid(950)}','${uid(20)}',3,'medical','active'),('${uid(951)}','${uid(30)}',1,'flood','active'),('${uid(952)}','${uid(20)}',1,'other','resolved');`)
  await db.exec(await migration('20261014_disaster_events.sql'))
  await db.exec(await migration('20261014_missing_person_reconciliation.sql'))
  const sql = await migration('20261017_rescue_dispatch_tickets.sql')
  await db.exec(sql); await db.exec(sql)

  async function actor(n, role = 'authenticated') {
    await db.exec('reset role')
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [n ? uid(n) : ''])
    await db.exec(`set role ${role}`)
  }
  const board = async () => (await db.query('select public.get_dispatch_board() as d')).rows[0].d
  const saveUnit = (id, name, barangay, caps = [], members = [], active = true) =>
    db.query('select public.save_rescue_unit($1,$2,$3,$4::text[],$5::uuid[],$6) as id',
      [id, name, barangay, `{${caps.map(c => `"${c}"`).join(',')}}`, `{${members.join(',')}}`, active])
  const create = (o = {}) => {
    const p = { barangay: 1, event: null, resident: uid(20), subject: 'Bedridden elder', source: 'manual', ref: null, priority: 'high',
      lat: null, lng: null, note: '', instr: '', equip: '{stretcher}', unit: null, ...o }
    return db.query('select public.create_dispatch_ticket($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::text[],$13) as id', Object.values(p))
  }
  const assign = (t, u, note = '') => db.query('select public.assign_dispatch_ticket($1,$2,$3)', [t, u, note])
  const status = (t, s, note = '') => db.query('select public.update_dispatch_status($1,$2,$3)', [t, s, note])

  // Units.
  await actor(1)
  const unitA = (await saveUnit(null, 'Alpha Team', 1, ['stretcher', 'boat', ' stretcher '], [uid(7)])).rows[0].id
  await assert.rejects(saveUnit(null, 'Barangay Team', null), /super admin/)
  await assert.rejects(saveUnit(null, 'Other Barangay', 2), /administrator access/)
  await assert.rejects(saveUnit(null, 'Bad', 1, [], [uid(20)]), /rescuer accounts/)
  await assert.rejects(saveUnit(null, 'Bad2', 1, [], [uid(9)]), /rescuer accounts/)
  await assert.rejects(saveUnit(null, ' alpha team ', 1), /already exists/)
  await actor(5)
  const unitB = (await saveUnit(null, 'Barangay Rescue 1', null, ['wheelchair'], [uid(8)])).rows[0].id
  await actor(1)
  await assert.rejects(saveUnit(unitB, 'Renamed', null), /super admin/)
  let b = await board()
  assert.deepEqual(b.units.map(u => [u.unit_name, u.editable, u.members.length]), [['Alpha Team', true, 1], ['Barangay Rescue 1', false, 1]])
  assert.deepEqual(b.units[0].capabilities, ['boat', 'stretcher'])
  assert.equal(b.rescuers.length, 2)

  // Intake: only active SOS in own barangay.
  assert.deepEqual(b.intake_sos.map(a => a.alert_id), [uid(950)])
  const t1 = (await create({ source: 'sos', ref: uid(950), priority: 'critical' })).rows[0].id
  await assert.rejects(create({ source: 'sos', ref: uid(950) }), /already exists/) // one live ticket per alert
  b = await board()
  assert.equal(b.intake_sos.length, 0)
  assert.equal(b.tickets[0].status, 'open')
  assert.equal(b.tickets[0].ticket_no >= 1, true)

  // Validation.
  for (const o of [{ barangay: 2 }, { resident: uid(30) }, { source: 'bogus' }, { source: 'sos', ref: uid(999) }, { priority: 'urgent' },
    { resident: null }, { resident: null, lat: 10.3 }, { subject: ' ' }, { unit: 999 }, { source: 'missing_report', ref: uid(999) }]) {
    await assert.rejects(create(o))
  }
  const t2 = (await create({ resident: null, lat: 10.31, lng: 123.91, note: 'Riverbank', unit: unitA, priority: 'normal', subject: 'Stranded family' })).rows[0].id
  b = await board()
  assert.equal(b.tickets.find(t => t.ticket_id === t2).status, 'assigned')
  assert.equal(b.units.find(u => u.unit_id === unitA).live_tickets, 1)
  assert.equal(b.tickets[0].ticket_id, t1) // critical first

  // Assign / lifecycle.
  await assert.rejects(status(t1, 'acknowledged'), /Assign a responder unit first/)
  await assign(t1, unitA)
  await assert.rejects(assign(t1, unitA), /already assigned/)
  await actor(7) // Alpha member, via the app
  await status(t1, 'acknowledged')
  await status(t1, 'en_route')
  await assert.rejects(status(t1, 'acknowledged'), /only move forward/)
  await assert.rejects(status(t1, 'cancelled', 'x'), /Only an administrator/)
  await actor(8) // not a member of Alpha
  await assert.rejects(status(t1, 'on_scene'), /administrator access/)
  await actor(1)
  await assert.rejects(assign(t1, unitB), /reason/) // already en route
  await assign(t1, unitB, 'Alpha boat broke down')
  await actor(8)
  await status(t1, 'on_scene')
  await assert.rejects(status(t1, 'resolved', ' '), /outcome/)
  await status(t1, 'resolved', 'Evacuated to San Isidro by stretcher')
  await assert.rejects(status(t1, 'on_scene'), /closed/)
  await actor(1)
  await assert.rejects(saveUnit(unitA, 'Alpha Team', 1, [], [uid(7)], false), /live tickets/) // t2 still live
  await status(t2, 'cancelled', 'Family self-evacuated')
  await saveUnit(unitA, 'Alpha Team', 1, [], [uid(7)], false)
  await assert.rejects(create({ unit: unitA }), /active responder unit/)
  const t3 = (await create({})).rows[0].id
  await assert.rejects(db.query("select public.cancel_open_dispatch_ticket($1,'')", [t3]), /reason/)
  await db.query("select public.cancel_open_dispatch_ticket($1,'Duplicate of D-1')", [t3])

  const hist = (await db.query('select public.get_dispatch_ticket_history($1) as h', [t1])).rows[0].h
  assert.deepEqual(hist.map(h => [h.action, h.to_status]), [['created', 'open'], ['assigned', 'assigned'], ['status', 'acknowledged'],
    ['status', 'en_route'], ['reassigned', 'assigned'], ['status', 'on_scene'], ['resolved', 'resolved']])
  assert.equal(hist[4].note, 'Alpha boat broke down')
  assert.equal(hist[6].actor_name, 'Rita X')

  // Missing report intake.
  const rep = (await db.query("select public.file_missing_person_report(1,null,$1,'Juan X','male',30,'',null,'Wife','','') as id", [uid(20)])).rows[0].id
  b = await board()
  assert.equal(b.intake_missing.length, 1)
  await create({ source: 'missing_report', ref: rep, subject: 'Search: Juan X' })
  assert.equal((await board()).intake_missing.length, 0)

  // Scope and access.
  await actor(2)
  b = await board()
  assert.equal(b.tickets.length, 0)
  assert.deepEqual(b.intake_sos.map(a => a.alert_id), [uid(951)])
  await assert.rejects(status(t1, 'resolved', 'x'), /closed|administrator access/)
  await actor(5); assert.equal((await board()).tickets.length, 4)
  for (const n of [4, 7, 20]) { await actor(n); await assert.rejects(board(), /administrator access/) }
  await actor(null, 'anon'); await assert.rejects(board(), /permission denied/)
  await actor(1)
  for (const q of ['select * from public.dispatch_tickets', 'select * from public.rescue_units', 'select * from public.dispatch_ticket_events',
    "update public.dispatch_tickets set status = 'resolved'"]) await assert.rejects(db.query(q), /permission denied/)
  console.log('rescue-dispatch SQL tests passed')
} finally {
  await db.close()
}
