// SQL test for 20261014_missing_person_reconciliation.sql against an isolated synthetic database.
// Usage: node tests/missing-persons.mjs <PGlite-module-path-or-file-URL>
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const { PGlite } = await import(process.argv[2] ?? '@electric-sql/pglite')
const db = await PGlite.create()
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
try {
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.sitios(sitio_id integer primary key,sitio_name text);
    create table public.users(uid uuid primary key,role text,account_status text,assigned_sitio_id integer,
      f_name text,m_name text,l_name text);
    create table public.residents(uid uuid primary key references public.users(uid),sitio_id integer references public.sitios(sitio_id),
      sex text,birthdate date);
    create table public.evacuation_centers(center_id integer primary key,center_name text);
    create table public.evacuation_records(record_id uuid primary key,resident_uid uuid references public.residents(uid),
      evac_center_id integer references public.evacuation_centers(center_id),evac_status text,evacuated_at timestamptz,logged_at timestamptz);
    insert into public.sitios values(1,'Sitio One'),(2,'Sitio Two');
    insert into public.evacuation_centers values(10,'Central School');
    grant usage on schema public,auth to authenticated,anon;`)
  const people = [
    // n, role, status, sitio, first, last
    [1,'admin','active',1,'Ana','Admin'],[2,'admin','active',2,'Ben','Admin'],[4,'admin','suspended',1,'Sus','Pended'],
    [5,'super_admin','active',null,'Sue','Per'],[6,'admin','active',null,'No','Sitio'],
    [20,'resident','active',1,'Juan','Dela Cruz'],[21,'resident','active',1,'Maria','Santos'],
    [22,'resident','active',1,'Pedro','Reyes'],[30,'resident','active',2,'Liza','Gomez'],
  ]
  for (const [n, role, status, sitio, f, l] of people) {
    await db.query('insert into auth.users values($1)', [uid(n)])
    await db.query('insert into public.users values($1,$2,$3,$4,$5,null,$6)', [uid(n), role, status, role === 'resident' ? null : sitio, f, l])
    if (role === 'resident') await db.query('insert into public.residents values($1,$2,$3,$4)', [uid(n), sitio, 'male', '1990-01-01'])
  }
  // Juan: in transit, then safely evacuated (latest). Maria: safely evacuated, then failed (latest). Pedro: no record.
  await db.exec(`insert into public.evacuation_records values
    ('${uid(901)}','${uid(20)}',null,'in_transit',null,'2026-10-14T01:00:00Z'),
    ('${uid(902)}','${uid(20)}',10,'safely_evacuated','2026-10-14T02:00:00Z','2026-10-14T02:00:00Z'),
    ('${uid(903)}','${uid(21)}',10,'safely_evacuated','2026-10-14T01:00:00Z','2026-10-14T01:00:00Z'),
    ('${uid(904)}','${uid(21)}',null,'failed',null,'2026-10-14T03:00:00Z'),
    ('${uid(905)}','${uid(30)}',10,'safely_evacuated','2026-10-14T02:00:00Z','2026-10-14T02:00:00Z');`)
  await db.exec(await readFile(new URL('../supabase/migrations/20261014_disaster_events.sql', import.meta.url), 'utf8'))
  const migration = await readFile(new URL('../supabase/migrations/20261014_missing_person_reconciliation.sql', import.meta.url), 'utf8')
  await db.exec(migration); await db.exec(migration)

  async function actor(n, role = 'authenticated') {
    await db.exec('reset role')
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [n ? uid(n) : ''])
    await db.exec(`set role ${role}`)
  }
  const file = (o = {}) => {
    const p = { sitio: 1, event: null, resident: null, name: 'Unregistered Child', sex: 'female', age: 7,
      where: 'Riverside', at: '2026-10-14T00:00:00Z', reporter: 'Neighbor', contact: '0917', notes: '', ...o }
    return db.query('select public.file_missing_person_report($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as id', Object.values(p))
  }
  const data = async () => (await db.query('select public.get_rescue_reconciliation() as data')).rows[0].data
  const found = (id, resident = null, note = '') => db.query('select public.mark_missing_person_found($1,$2,$3)', [id, resident, note])
  const withdraw = (id, reason = 'Duplicate report') => db.query('select public.withdraw_missing_person_report($1,$2)', [id, reason])

  await actor(1)
  const view = await data()
  assert.equal(view.sitios.length, 1)
  assert.equal(view.residents.length, 3)
  const byUid = Object.fromEntries(view.residents.map(r => [r.uid, r]))
  assert.equal(byUid[uid(20)].latest_status, 'safely_evacuated')
  assert.equal(byUid[uid(20)].center_name, 'Central School')
  assert.equal(byUid[uid(21)].latest_status, 'failed')
  assert.equal(byUid[uid(22)].latest_status, null)

  const childId = (await file()).rows[0].id
  const juanId = (await file({ resident: uid(20), name: 'Juan Dela Cruz', sex: 'male', age: 36 })).rows[0].id
  const mariaId = (await file({ resident: uid(21), name: 'Maria Santos', sex: 'female', age: 36 })).rows[0].id
  assert.equal((await data()).reports.length, 3)
  await assert.rejects(file({ resident: uid(20), name: 'Juan again' }), /already has an open/)
  for (const o of [{ sitio: 2 }, { sitio: null }, { resident: uid(30) }, { name: ' ' }, { reporter: '' }, { sex: 'x' },
    { age: 200 }, { at: '2999-01-01T00:00:00Z' }, { notes: 'x'.repeat(2001) }, { event: uid(999) }]) {
    await assert.rejects(file(o))
  }

  // Confirm Juan against the rescued directory; Maria's latest record is failed, so she cannot be matched.
  await assert.rejects(found(juanId, uid(22)), /different registered resident/)
  await found(juanId, uid(20))
  await assert.rejects(found(juanId, uid(20)), /already closed/)
  await assert.rejects(found(mariaId, uid(21)), /not in the Master Rescued Directory/)
  await assert.rejects(found(childId, uid(22)), /not in the Master Rescued Directory/)
  await assert.rejects(found(childId, null, '  '), /Describe where/)
  await assert.rejects(withdraw(mariaId, ' '), /withdrawal reason/)
  await withdraw(mariaId)
  await found(childId, null, 'Found at relative\'s house in Sitio Two')
  const closed = Object.fromEntries((await data()).reports.map(r => [r.report_id, r]))
  assert.equal(closed[juanId].status, 'found')
  assert.equal(closed[juanId].matched_resident_uid, uid(20))
  assert.equal(closed[juanId].reconciliation_note, 'Matched to Master Rescued Directory.')
  assert.equal(closed[mariaId].status, 'withdrawn')
  assert.equal(closed[childId].matched_resident_uid, null)
  // Closing frees the resident for a new open report.
  await file({ resident: uid(20), name: 'Juan Dela Cruz' })

  // Scope and access.
  await actor(2)
  assert.equal((await data()).reports.length, 0)
  assert.equal((await data()).residents.length, 1)
  await assert.rejects(found(childId, null, 'x'), /administrator access/)
  await assert.rejects(file({ sitio: 1 }), /administrator access/)
  await file({ sitio: 2, resident: uid(30), name: 'Liza Gomez' })
  await actor(5)
  assert.equal((await data()).reports.length, 5)
  assert.equal((await data()).residents.length, 4)
  for (const n of [4, 6, 20]) { await actor(n); await assert.rejects(data(), /administrator access/) }
  await actor(null)
  await assert.rejects(data(), /administrator access/)
  await actor(1)
  await assert.rejects(db.query('select * from public.missing_person_reports'), /permission denied/)
  await assert.rejects(db.query("update public.missing_person_reports set status='found'"), /permission denied/)
  await assert.rejects(db.query('select * from public.missing_person_report_audit'), /permission denied/)
  await actor(null, 'anon')
  await assert.rejects(data(), /permission denied/)

  await db.exec('reset role')
  const audit = (await db.query('select action, count(*)::int as n from public.missing_person_report_audit group by action order by action')).rows
  assert.deepEqual(audit, [{ action: 'found', n: 2 }, { action: 'reported', n: 5 }, { action: 'withdrawn', n: 1 }])
  console.log('missing-persons SQL tests passed')
} finally {
  await db.close()
}
