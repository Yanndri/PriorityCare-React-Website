// SQL test for 20261017_equipment_matching_rules.sql against an isolated synthetic database.
// Usage: node tests/equipment-rules.mjs <PGlite-module-path-or-file-URL>
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
    create table public.disability_types(disability_id integer primary key,disability_name text unique);
    insert into public.sitios values(1,'Sitio One');
    insert into public.disability_types values(1,'Visual'),(2,'Hearing'),(3,'Physical'),(4,'Intellectual'),(5,'Psychosocial');
    grant usage on schema public,auth to authenticated,anon;`)
  for (const [n, role, status, sitio] of [[1,'admin','active',1],[4,'admin','suspended',1],[5,'super_admin','active',null],[20,'resident','active',null]]) {
    await db.query('insert into auth.users values($1)', [uid(n)])
    await db.query('insert into public.users values($1,$2,$3,$4,$5,$6)', [uid(n), role, status, sitio, `U${n}`, 'X'])
  }
  await db.exec(await migration('20261014_disaster_events.sql'))
  const sql = await migration('20261017_equipment_matching_rules.sql')
  await db.exec(sql); await db.exec(sql) // repeatable; defaults not duplicated
  async function actor(n, role = 'authenticated') {
    await db.exec('reset role')
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [n ? uid(n) : ''])
    await db.exec(`set role ${role}`)
  }
  const get = async () => (await db.query('select public.get_equipment_rules() as d')).rows[0].d
  const save = (id, kind, value, equipment, note = '', active = true) =>
    db.query('select public.save_equipment_rule($1,$2,$3,$4,$5,$6) as id', [id, kind, value, equipment, note, active])

  await actor(1)
  let d = await get()
  assert.equal(d.can_edit, false)
  assert.equal(d.rules.length, 17)
  assert.equal(d.disability_types.length, 5)
  await assert.rejects(save(null, 'needs_keyword', 'cpap', 'Oxygen'), /super admin/)

  await actor(5)
  assert.equal((await get()).can_edit, true)
  const id = (await save(null, 'needs_keyword', ' CPAP ', 'Oxygen', 'Sleep apnea machine')).rows[0].id
  d = await get()
  assert.equal(d.rules.find(r => r.rule_id === id).match_value, 'cpap')
  assert.equal(d.rules.find(r => r.rule_id === id).updated_by_name, 'U5 X')
  await save(id, 'needs_keyword', 'cpap', 'Oxygen', 'Sleep apnea machine', false)
  assert.equal((await get()).rules.find(r => r.rule_id === id).is_active, false)
  await save(null, 'mobility', 'Semi-Ambulatory', 'Walking aid') // normalised
  await save(null, 'pregnancy', 'anything', 'Birthing kit') // value forced to 'true'
  for (const [args, re] of [
    [[null, 'needs_keyword', 'oxygen', 'oxygen'], /identical/], [[null, 'disability', 'Blind', 'Guide rope'], /Unknown disability/],
    [[null, 'age_under', 'five', 'Infant kit'], /Check the rule/], [[null, 'mobility', 'flying', 'Wings'], /Check the rule/],
    [[null, 'bogus', 'x', 'y'], /Check the rule/], [[null, 'needs_keyword', 'x', ' '], /Check the rule/], [[999, 'needs_keyword', 'x', 'y'], /not found/]]) {
    await assert.rejects(save(...args), re)
  }
  for (const n of [4, 20]) { await actor(n); await assert.rejects(get(), /administrator access/) }
  await actor(null, 'anon'); await assert.rejects(get(), /permission denied/)
  await actor(5)
  await assert.rejects(db.query('select * from public.equipment_rules'), /permission denied/)
  await db.exec('reset role')
  assert.equal((await db.query('select count(*)::int as n from public.equipment_rule_audit')).rows[0].n, 4)
  console.log('equipment-rules SQL tests passed')
} finally {
  await db.close()
}
