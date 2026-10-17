-- Demo/mock data for PriorityCare. Safe to re-run (inserts are skipped if rows already exist).
-- Every mock person uses an @mock.prioritycare.test email and a c0ffee00-… UUID.
-- Remove everything with supabase/seed/mock_data_cleanup.sql.
-- Requires the disaster_events and missing_person_reconciliation migrations, and an existing
-- super_admin account (used as the declaring/reporting user).
begin;

-- Mock evacuation centers -------------------------------------------------------------
insert into public.evacuation_centers(center_id, center_name, center_type, gps_lat, gps_long, capacity, status, updated_at) values
  (9001, 'San Isidro Elementary School', 'school',        10.3215, 123.9032, 150, 'active', now()),
  (9002, 'Sitio 3 Covered Court',        'covered_court', 10.3241, 123.9010,  80, 'active', now()),
  (9003, 'Sitio 1 Barangay Hall',        'barangay_hall', 10.3108, 123.8921,  60, 'active', now())
on conflict (center_id) do nothing;

-- Mock residents (users + residents) --------------------------------------------------
with m(n, sitio, f, l, verified) as (values
  (1, 3, 'Jose','Mercado',true),(2, 3, 'Lorna','Mercado',true),(3, 3, 'Andres','Villanueva',true),
  (4, 3, 'Cristina','Bautista',true),(5, 3, 'Miguel','Bautista',true),(6, 3, 'Rosario','Del Rosario',true),
  (7, 3, 'Ramon','Aquino',true),(8, 3, 'Elena','Garcia',true),(9, 3, 'Paolo','Lim',true),
  (10, 3, 'Teresita','Flores',true),(11, 3, 'Benjie','Navarro',false),(12, 1, 'Carmela','Reyes',true),
  (13, 1, 'Dante','Ocampo',true),(14, 1, 'Grace','Tan',true),(15, 1, 'Ernesto','Cruz',true),
  (16, 2, 'Liza','Gomez',true),(17, 2, 'Noel','Santos',false),(18, 2, 'Pilar','Dizon',true)
)
insert into public.users(uid, role, email, f_name, l_name, contact_no, is_verified, account_status)
select ('c0ffee00-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'resident',
       lower(f || '.' || replace(l, ' ', '') || '@mock.prioritycare.test'), f, l, '0999000' || lpad(n::text, 4, '0'), verified, 'active'
from m on conflict do nothing;

with m(n, sitio, sex, birthdate, mobility) as (values
  (1,3,'male','1958-03-12','non_ambulatory'),(2,3,'female','1961-07-02','semi_ambulatory'),(3,3,'male','1990-11-20','ambulatory'),
  (4,3,'female','1995-02-14','ambulatory'),(5,3,'male','2016-06-30','ambulatory'),(6,3,'female','1949-09-09','non_ambulatory'),
  (7,3,'male','1972-04-04','semi_ambulatory'),(8,3,'female','1983-12-01','ambulatory'),(9,3,'male','2001-08-18','ambulatory'),
  (10,3,'female','1940-05-25','non_ambulatory'),(11,3,'male','1978-01-15','ambulatory'),(12,1,'female','1987-03-03','ambulatory'),
  (13,1,'male','1966-10-10','semi_ambulatory'),(14,1,'female','2010-02-22','ambulatory'),(15,1,'male','1955-07-07','non_ambulatory'),
  (16,2,'female','1992-09-19','ambulatory'),(17,2,'male','1980-05-05','ambulatory'),(18,2,'female','1945-12-12','non_ambulatory')
)
insert into public.residents(uid, sitio_id, sex, birthdate, mobility_status, emerg_contact_name, emerg_contact_no, gps_lat, gps_long, last_heartbeat)
select u.uid, m.sitio, m.sex::public.sex_type, m.birthdate::date, m.mobility::public.mobility_type,
       'Kin of ' || u.f_name || ' ' || u.l_name, '0998000' || lpad(m.n::text, 4, '0'),
       case m.sitio when 3 then 10.3230 when 1 then 10.3110 else 10.3170 end + (m.n % 5) * 0.0011,
       case m.sitio when 3 then 123.9020 when 1 then 123.8930 else 123.8975 end + (m.n % 4) * 0.0013,
       now() - (m.n || ' minutes')::interval
from m join public.users u on u.uid = ('c0ffee00-0000-4000-8000-' || lpad(m.n::text, 12, '0'))::uuid
on conflict (uid) do nothing;

-- Disabilities ------------------------------------------------------------------------
insert into public.resident_disabilities(resident_uid, disability_id)
select ('c0ffee00-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, d.disability_id
from (values (1, 'Physical'), (6, 'Physical'), (6, 'Visual'), (10, 'Physical'), (10, 'Hearing'),
             (13, 'Hearing'), (15, 'Physical'), (18, 'Physical')) v(n, name)
join public.disability_types d on d.disability_name = v.name
on conflict do nothing;

-- Households and profile details ------------------------------------------------------
insert into public.households(household_id, household_name, sitio_id, head_uid, household_members) values
  ('c0ffee00-0000-4000-8004-000000000001', 'Mercado Household', 3, 'c0ffee00-0000-4000-8000-000000000001',
   '[{"name":"Baby Mercado","relationship":"Granddaughter","birthdate":"2024-05-01","sex":"female","is_pregnant":false,"needs":"Infant formula and diapers"}]'),
  ('c0ffee00-0000-4000-8004-000000000002', 'Bautista Household', 3, 'c0ffee00-0000-4000-8000-000000000004', '[]')
on conflict do nothing;

insert into public.resident_profile_details(resident_uid, address, landmark, is_pregnant, vulnerability_needs, household_id)
select ('c0ffee00-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, addr, landmark, pregnant, needs, hh::uuid
from (values
  (1, 'Purok 2, Sitio 3', 'Beside the chapel', false, 'Bedridden; needs stretcher transfer', 'c0ffee00-0000-4000-8004-000000000001'),
  (2, 'Purok 2, Sitio 3', 'Beside the chapel', false, 'Uses a cane', 'c0ffee00-0000-4000-8004-000000000001'),
  (4, 'Purok 4, Sitio 3', 'Near the river bridge', true, '7 months pregnant', 'c0ffee00-0000-4000-8004-000000000002'),
  (5, 'Purok 4, Sitio 3', 'Near the river bridge', false, 'Minor; travels with mother', 'c0ffee00-0000-4000-8004-000000000002'),
  (6, 'Purok 1, Sitio 3', 'Green gate, end of alley', false, 'Bedridden, low vision, lives alone', null),
  (10, 'Purok 3, Sitio 3', 'Sari-sari store corner', false, 'Wheelchair user; hearing aid', null)
) v(n, addr, landmark, pregnant, needs, hh)
on conflict do nothing;

-- Evacuation records (latest record per resident drives the rescued directory) ----------
insert into public.evacuation_records(record_id, resident_uid, rescuer_uid, evac_center_id, evac_status, evacuated_at, logged_at)
select ('c0ffee00-0000-4000-8003-' || lpad(rid::text, 12, '0'))::uuid,
       ('c0ffee00-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
       (select uid from public.users where role = 'rescuer' and account_status = 'active' order by email limit 1),
       center, status::public.evac_status_type,
       case when status = 'safely_evacuated' then now() - (mins || ' minutes')::interval end,
       now() - (mins || ' minutes')::interval
from (values
  (1, 1, 9001, 'safely_evacuated', 300), (2, 2, 9001, 'safely_evacuated', 290), (3, 3, 9002, 'safely_evacuated', 240),
  (4, 4, 9001, 'safely_evacuated', 220), (5, 5, null, 'in_transit', 30),       (6, 6, null, 'failed', 90),
  (7, 7, null, 'pending', 60),           (8, 9, 9002, 'safely_evacuated', 180), (9, 10, null, 'in_transit', 260),
  (10, 10, 9001, 'safely_evacuated', 200), (11, 12, 9003, 'safely_evacuated', 150), (12, 13, null, 'failed', 120),
  (13, 14, null, 'pending', 45),        (14, 15, 9003, 'safely_evacuated', 140), (15, 16, 1, 'safely_evacuated', 400),
  (16, 18, null, 'in_transit', 20)
) v(rid, n, center, status, mins)
on conflict (record_id) do nothing;

-- Disaster events ---------------------------------------------------------------------
insert into public.disaster_events(event_id, sitio_id, name, hazard_type, location_description, latitude, longitude,
                                   started_at, notes, status, declared_at, declared_by, resolved_at, resolved_by, resolution_reason)
select e.id::uuid, e.sitio, e.name, e.hazard, e.loc, e.lat, e.lng, now() - (e.hours || ' hours')::interval, e.notes,
       e.status, now() - (e.hours || ' hours')::interval + interval '20 minutes', sa.uid,
       case when e.status = 'resolved' then now() - interval '2 days' end,
       case when e.status = 'resolved' then sa.uid end,
       case when e.status = 'resolved' then 'Fire extinguished; area cleared by BFP.' end
from (values
  ('c0ffee00-0000-4000-8001-000000000001', 3, 'Riverside flood', 'flood', 'Purok 2–4 along the riverbank', 10.3236, 123.9018, 6, 'River overflowed after continuous rain; waist-deep water in Purok 2.', 'active'),
  ('c0ffee00-0000-4000-8001-000000000002', 1, 'Hillside landslide', 'landslide', 'Upper Sitio 1 road cut', 10.3121, 123.8915, 4, 'Soil movement reported by tanod; road partially blocked.', 'active'),
  ('c0ffee00-0000-4000-8001-000000000003', 2, 'Market row fire', 'fire', 'Sitio 2 public market, row B', 10.3172, 123.8981, 72, 'Three stalls affected.', 'resolved')
) e(id, sitio, name, hazard, loc, lat, lng, hours, notes, status)
cross join (select uid from public.users where role = 'super_admin' and account_status = 'active' order by created_at limit 1) sa
on conflict do nothing;

insert into public.disaster_event_audit(event_id, action, actor_uid, details)
select e.event_id, a.action, e.declared_by, jsonb_build_object('mock', true)
from public.disaster_events e
cross join lateral (values ('declared'), ('resolved')) a(action)
where e.event_id::text like 'c0ffee00-%' and (a.action = 'declared' or e.status = 'resolved')
  and not exists (select 1 from public.disaster_event_audit x where x.event_id = e.event_id and x.action = a.action);

-- Missing persons manifest ------------------------------------------------------------
insert into public.missing_person_reports(report_id, sitio_id, event_id, resident_uid, full_name, sex, approx_age,
    last_seen_location, last_seen_at, reporter_name, reporter_contact, notes, status, matched_resident_uid,
    reconciled_at, reconciled_by, reconciliation_note, reported_at, reported_by)
select ('c0ffee00-0000-4000-8002-' || lpad(r.n::text, 12, '0'))::uuid, r.sitio,
       r.event::uuid, r.resident::uuid, r.name, r.sex, r.age, r.loc, now() - (r.seen_h || ' hours')::interval,
       r.reporter, r.contact, r.notes, r.status, null,
       case when r.status <> 'missing' then now() - interval '30 minutes' end,
       case when r.status <> 'missing' then sa.uid end,
       r.note, now() - (r.rep_h || ' hours')::interval, sa.uid
from (values
  -- linked to a rescued resident → "Confirmed in rescued directory"
  (1, 3, 'c0ffee00-0000-4000-8001-000000000001', 'c0ffee00-0000-4000-8000-000000000003', 'Andres Villanueva', 'male', 35,
   'Riverbank near Purok 3', 5, 'Mylene Villanueva (sister)', '09171234501', 'Went back to check on livestock.', 'missing', null, 4),
  -- typo of a rescued resident → "Probable match"
  (2, 3, 'c0ffee00-0000-4000-8001-000000000001', null, 'Teresita Floress', 'female', 86,
   'Her house, Purok 3', 6, 'Barangay tanod', '09171234502', 'Elderly, uses a wheelchair.', 'missing', null, 5),
  -- partial name, no age → "Possible match"
  (3, 3, 'c0ffee00-0000-4000-8001-000000000001', null, 'Paolo', 'male', null,
   'Basketball court', 3, 'Friend (no surname given)', '', 'Only first name known.', 'missing', null, 2),
  -- unregistered infant → "Still missing"
  (4, 3, 'c0ffee00-0000-4000-8001-000000000001', null, 'Baby Girl Mercado', 'female', 2,
   'Mercado house, Purok 2', 5, 'Neighbor', '09171234504', 'Dependent without an account; may be with grandparents.', 'missing', null, 3),
  -- linked resident whose latest record is failed → "Still missing"
  (5, 3, 'c0ffee00-0000-4000-8001-000000000001', 'c0ffee00-0000-4000-8000-000000000006', 'Rosario Del Rosario', 'female', 77,
   'Her house, Purok 1', 4, 'Parish volunteer', '09171234505', 'Rescue team could not reach the house.', 'missing', null, 1),
  -- closed: found outside the directory
  (6, 3, 'c0ffee00-0000-4000-8001-000000000001', null, 'Elmer Pascual', 'male', 52,
   'Fish pond, Purok 4', 7, 'Wife', '09171234506', '', 'found', 'Found safe at relative''s house in Sitio 2.', 6),
  -- closed: duplicate report withdrawn
  (7, 3, 'c0ffee00-0000-4000-8001-000000000001', null, 'Teresita Flores', 'female', 86,
   'Purok 3', 6, 'Grandson (phone call)', '', '', 'withdrawn', 'Duplicate of the tanod''s report.', 5),
  -- Sitio 1
  (8, 1, 'c0ffee00-0000-4000-8001-000000000002', 'c0ffee00-0000-4000-8000-000000000013', 'Dante Ocampo', 'male', 60,
   'Upper road cut', 3, 'Neighbor', '09171234508', 'Last seen clearing debris.', 'missing', null, 2),
  (9, 1, 'c0ffee00-0000-4000-8001-000000000002', null, 'Carmela Reyes', 'female', 39,
   'Sitio 1 chapel', 3, 'Co-worker', '09171234509', '', 'missing', null, 2)
) r(n, sitio, event, resident, name, sex, age, loc, seen_h, reporter, contact, notes, status, note, rep_h)
cross join (select uid from public.users where role = 'super_admin' and account_status = 'active' order by created_at limit 1) sa
on conflict do nothing;

insert into public.missing_person_report_audit(report_id, action, actor_uid, details)
select m.report_id, a.action, m.reported_by, jsonb_build_object('mock', true)
from public.missing_person_reports m
cross join lateral (values ('reported'), ('found'), ('withdrawn')) a(action)
where m.report_id::text like 'c0ffee00-%' and (a.action = 'reported' or a.action = m.status)
  and not exists (select 1 from public.missing_person_report_audit x where x.report_id = m.report_id and x.action = a.action);

-- Sitio -> shelter catchment plans (Module 2.2; requires 20261017_sitio_shelter_catchments.sql)
insert into public.sitio_shelter_plans(sitio_id, primary_center_id, alternate_center_ids, note, updated_by)
select v.sitio, v.primary_center, v.alts, v.note, sa.uid
from (values
  (3, 9001, array[9002], 'Mock: Purok 1–4 to the school; covered court if full'),
  (1, 9003, array[1], 'Mock: barangay hall first, sports complex as backup')
) v(sitio, primary_center, alts, note)
cross join (select uid from public.users where role = 'super_admin' and account_status = 'active' order by created_at limit 1) sa
where to_regclass('public.sitio_shelter_plans') is not null
on conflict (sitio_id) do nothing;

commit;
