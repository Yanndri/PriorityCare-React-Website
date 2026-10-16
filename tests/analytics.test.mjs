import test from 'node:test'
import assert from 'node:assert/strict'
import { reconcile, namesAgree, reconciliationTables } from '../src/utils/reconciliation.ts'
import { toCoordinate, hasFactor, matchesCategory, gridCells, eventsInFilter, categoryBreakdown } from '../src/utils/vulnerabilityHeat.ts'
import { manilaDateRange, toCsv, manilaTimestamp, countByCategory, timelineRows } from '../src/utils/auditTrail.ts'
import { makeReportWindow, buildRdanaSummary, manifestActivity, eventsDuringWindow } from '../src/utils/rdana.ts'
import { buildDromicReport } from '../src/utils/dromicReport.ts'

const asOf = '2026-10-16T00:00:00Z'
const resident = (uid, f, l, extra = {}) => ({
  uid, sitio_id: 3, f_name: f, m_name: null, l_name: l, sex: 'female', birthdate: '1990-05-01',
  latest_status: null, latest_logged_at: null, evacuated_at: null, center_id: null, center_name: null, ...extra,
})
const report = (id, name, extra = {}) => ({
  report_id: id, sitio_id: 3, event_id: null, resident_uid: null, full_name: name, sex: null, approx_age: null,
  last_seen_location: '', last_seen_at: null, notes: '', status: 'missing', matched_resident_uid: null,
  reconciled_at: null, reconciliation_note: null, reported_at: '2026-10-15T00:00:00Z', ...extra,
})
const recon = (reports, residents) => reconcile({ generated_at: asOf, sitios: [{ sitio_id: 3, sitio_name: 'Sitio 3' }], events: [], reports, residents }, asOf)

test('ID-linked rescued resident is ready to close and flagged as a discrepancy', () => {
  const r = recon([report('1', 'Ana Cruz', { resident_uid: 'a' })], [resident('a', 'Ana', 'Cruz', { latest_status: 'safely_evacuated', center_name: 'Gym' })])
  assert.equal(r.rows[0].outcome, 'ready_to_close')
  assert.match(r.rows[0].discrepancies.join(), /still open/)
  assert.equal(r.counts.ready_to_close, 1)
  assert.equal(r.rescuedDirectory.length, 1)
})

test('ID-linked resident not rescued stays unresolved with latest status', () => {
  const r = recon([report('1', 'Ana Cruz', { resident_uid: 'a' })], [resident('a', 'Ana', 'Cruz', { latest_status: 'failed' })])
  assert.equal(r.rows[0].outcome, 'unresolved')
  assert.match(r.rows[0].evidence, /failed/)
})

test('name agreement alone never matches; corroboration only yields a possible match', () => {
  const people = [resident('a', 'Ana', 'Cruz', { latest_status: 'safely_evacuated' })]
  const nameOnly = recon([report('1', 'Ana Cruz')], [{ ...people[0], sex: null, birthdate: null }])
  assert.equal(nameOnly.rows[0].outcome, 'unresolved')
  assert.match(nameOnly.rows[0].discrepancies.join(), /share the name only/)
  const corroborated = recon([report('1', 'Ana Cruz', { sex: 'female', approx_age: 37 })], people)
  assert.equal(corroborated.rows[0].outcome, 'possible_match')
  assert.equal(corroborated.rows[0].linkedResident, null)
  assert.match(corroborated.rows[0].evidence, /Not a confirmed match/)
})

test('conflicting sex or age excludes a same-name resident', () => {
  const people = [resident('a', 'Ana', 'Cruz', { latest_status: 'safely_evacuated' })]
  assert.equal(recon([report('1', 'Ana Cruz', { sex: 'male' })], people).rows[0].outcome, 'unresolved')
  const age = recon([report('1', 'Ana Cruz', { approx_age: 70 })], people)
  assert.equal(age.rows[0].outcome, 'unresolved')
  assert.match(age.rows[0].discrepancies.join(), /conflicting sex or age/)
})

test('similar but different names do not agree (no fuzzy matching)', () => {
  assert.equal(namesAgree('Jon Dela Cruz', resident('a', 'John', 'Dela Cruz')), false)
  assert.equal(namesAgree('Maria Ana Cruz', resident('a', 'Ana', 'Cruz')), true)
  assert.equal(namesAgree('José Cruz', resident('a', 'Jose', 'Cruz')), true)
  assert.equal(namesAgree('Ana', resident('a', 'Ana', null)), false)
})

test('closed reports, regressions, duplicates and withdrawals are reported', () => {
  const r = recon([
    report('1', 'Ana Cruz', { status: 'found', matched_resident_uid: 'a', reconciliation_note: 'ok' }),
    report('2', 'Ben Diaz', { status: 'found', reconciliation_note: 'Found at relative' }),
    report('3', 'Carl Lim', { status: 'withdrawn', reconciliation_note: 'Duplicate' }),
    report('4', 'Dina Uy'), report('5', 'dina  UY'),
  ], [resident('a', 'Ana', 'Cruz', { latest_status: 'in_transit' })])
  assert.deepEqual(r.rows.map((row) => row.outcome), ['closed_matched', 'closed_note', 'withdrawn', 'unresolved', 'unresolved'])
  assert.match(r.rows[0].discrepancies.join(), /now "in_transit"/)
  assert.match(r.rows[3].discrepancies.join(), /duplicate/)
  assert.equal(r.counts.open, 2)
  const [manifest, directory] = reconciliationTables({ generated_at: asOf, sitios: [{ sitio_id: 3, sitio_name: 'Sitio 3' }], events: [], reports: [], residents: [] }, r)
  assert.equal(manifest.rows.length, 5)
  assert.equal(manifest.headers.some((header) => /contact/i.test(header)), false)
  assert.equal(directory.rows.length, 0)
})

test('coordinates: only finite, in-range, non-placeholder values are plotted', () => {
  assert.deepEqual(toCoordinate('10.3', '123.9'), { lat: 10.3, lng: 123.9 })
  for (const [lat, lng] of [[null, 1], ['', 1], [0, 0], [91, 1], [1, 181], ['x', 1], [undefined, undefined]]) assert.equal(toCoordinate(lat, lng), null)
})

test('vulnerability factors distinguish recorded-absent from not recorded', () => {
  assert.equal(hasFactor({ id: 1, mobilityStatus: 'non_ambulatory' }, 'non_ambulatory', asOf), true)
  assert.equal(hasFactor({ id: 1, mobilityStatus: 'ambulatory' }, 'non_ambulatory', asOf), false)
  assert.equal(hasFactor({ id: 1 }, 'non_ambulatory', asOf), null)
  assert.equal(hasFactor({ id: 1 }, 'pregnant', asOf), null)
  assert.equal(hasFactor({ id: 1, disabilityCount: 0 }, 'disability', asOf), false)
  assert.equal(hasFactor({ id: 1, birthdate: '2023-01-01' }, 'under_5', asOf), true)
  assert.equal(hasFactor({ id: 1, birthdate: 'bad' }, 'age_60_plus', asOf), null)
  assert.equal(matchesCategory({ id: 1 }, 'any', asOf), false)
  assert.equal(matchesCategory({ id: 1 }, 'registered', asOf), true)
  const [mobility] = categoryBreakdown([{ id: 1, mobilityStatus: 'non_ambulatory' }, { id: 2, mobilityStatus: 'ambulatory' }, { id: 3 }], asOf)
  assert.deepEqual([mobility.present, mobility.absent, mobility.unknown], [1, 1, 1])
})

test('grid aggregation counts every point once', () => {
  const cells = gridCells([{ lat: 10.3, lng: 123.9 }, { lat: 10.3001, lng: 123.9001 }, { lat: 10.4, lng: 123.9 }], 250)
  assert.equal(cells.reduce((sum, cell) => sum + cell.count, 0), 3)
  assert.equal(cells[0].count, 2)
  assert.deepEqual(gridCells([], 250), [])
})

test('event filters use onset dates in Asia/Manila', () => {
  const events = [
    { event_id: 'a', name: 'A', hazard_type: 'flood', status: 'active', started_at: '2026-10-09T16:30:00Z', latitude: 1, longitude: 1 },
    { event_id: 'b', name: 'B', hazard_type: 'fire', status: 'resolved', started_at: '2026-10-11T00:00:00Z', latitude: 1, longitude: 1 },
  ]
  assert.deepEqual(eventsInFilter(events, { hazard: 'all', status: 'all', from: '2026-10-10', to: '2026-10-10' }).map((e) => e.event_id), ['a'])
  assert.deepEqual(eventsInFilter(events, { hazard: 'fire', status: 'all', from: '', to: '' }).map((e) => e.event_id), ['b'])
  assert.deepEqual(eventsInFilter(events, { hazard: 'all', status: 'active', from: '', to: '' }).map((e) => e.event_id), ['a'])
})

test('audit ranges are inclusive Manila days converted to exact UTC bounds', () => {
  assert.deepEqual(manilaDateRange('2026-10-01', '2026-10-01'), { from: '2026-09-30T16:00:00.000Z', to: '2026-10-01T16:00:00.000Z' })
  assert.throws(() => manilaDateRange('2026-10-02', '2026-10-01'), /on or before/)
  assert.throws(() => manilaDateRange('2025-01-01', '2026-10-01'), /at most 366/)
  assert.throws(() => manilaDateRange('', '2026-10-01'), /both/)
  assert.equal(manilaTimestamp('2026-10-01T16:00:05.123Z'), '2026-10-02 00:00:05 PHT')
})

test('CSV export quotes, escapes, and neutralises formula-like text', () => {
  const csv = toCsv(['a', 'b'], [['=SUM(1)', 'x,"y"'], [5, null], ['+cmd', 'line\nbreak']])
  assert.equal(csv, 'a,b\r\n\'=SUM(1),"x,""y"""\r\n5,\r\n\'+cmd,"line\nbreak"\r\n')
})

test('timeline rows keep exact UTC and Manila times and unrecorded actors', () => {
  const data = { generated_at: asOf, from: '', to: '', scope: 'Sitio 3', sitios: [{ sitio_id: 3, sitio_name: 'Sitio 3' }], events: [
    { occurred_at: '2026-10-14T12:27:03.935451+00:00', category: 'evacuation', action: 'Evacuation status logged', subject: 'A', sitio_id: 3, from_value: null, to_value: 'safely_evacuated', actor_name: null, actor_role: null, details: null, ref_id: 'r1' },
    { occurred_at: '2026-10-14T13:00:00Z', category: 'facility', action: 'Center status changed', subject: 'Gym', sitio_id: null, from_value: 'active', to_value: 'closed', actor_name: 'Admin', actor_role: 'admin', details: 'Reason: full', ref_id: '7' },
  ] }
  const rows = timelineRows(data, data.events)
  assert.equal(rows[0][0], '2026-10-14T12:27:03.935Z')
  assert.equal(rows[0][1], '2026-10-14 20:27:03 PHT')
  assert.equal(rows[0][8], 'Not recorded')
  assert.equal(rows[1][5], 'All sitios (facility-wide)')
  assert.equal(countByCategory(data.events).evacuation, 1)
  assert.equal(countByCategory([]).sos, 0)
})

const window = makeReportWindow(24, '2026-10-15T04:00:00Z')
const available = (data) => ({ available: true, data })
const base = () => ({
  window, scope: 'Sitio 3', fetchedAt: window.end, residents: [{ uid: 'a', birthdate: '1990-01-01', mobility_status: 'ambulatory' }],
  sos: available([]), loggedEvacuations: available([]), completedEvacuations: available([]), profiles: available([]),
  disabilityResidents: available([]), shelters: available([]),
})
const manifestRows = [
  { report_id: '1', status: 'missing', reported_at: '2026-10-14T05:00:00Z', reconciled_at: null },
  { report_id: '2', status: 'found', reported_at: '2026-10-01T00:00:00Z', reconciled_at: '2026-10-14T06:00:00Z' },
  { report_id: '3', status: 'missing', reported_at: '2026-10-01T00:00:00Z', reconciled_at: null },
  { report_id: '3', status: 'missing', reported_at: '2026-10-01T00:00:00Z', reconciled_at: null },
]
const eventRows = [
  { event_id: 'e1', name: 'Typhoon flooding', hazard_type: 'flood', status: 'active', started_at: '2026-10-10T00:00:00Z', resolved_at: null },
  { event_id: 'e2', name: 'Old fire', hazard_type: 'fire', status: 'resolved', started_at: '2026-09-01T00:00:00Z', resolved_at: '2026-09-02T00:00:00Z' },
]

test('manifest and event helpers use window timestamps and deduplicate', () => {
  assert.deepEqual(manifestActivity(manifestRows, window), { filed: 1, found: 1, withdrawn: 0, openNow: 2 })
  assert.deepEqual(eventsDuringWindow(eventRows, window).map((e) => e.event_id), ['e1'])
})

test('RDANA includes the manifest, declared events and data sources when retrieved', () => {
  const text = buildRdanaSummary({ ...base(), missingReports: available(manifestRows), declaredEvents: available(eventRows) })
  assert.match(text, /reports filed in period 1; marked found in period 1; withdrawn in period 0; open reports at retrieval 2/)
  assert.match(text, /Declared disaster events active during the period \(register; sitio-scoped\): 1/)
  assert.match(text, /Typhoon flooding — flood/)
  assert.doesNotMatch(text, /Old fire/)
  assert.match(text, /7\. DATA SOURCES/)
  assert.match(text, /Missing-person manifest: retrieved/)
  assert.match(text, /Deaths, injuries, damaged homes/)
  assert.doesNotMatch(text, /Deaths, injuries, missing persons/)
})

test('RDANA marks an unavailable manifest as Not available, never zero', () => {
  const text = buildRdanaSummary({ ...base(), missingReports: { available: false, reason: 'denied' }, declaredEvents: { available: false, reason: 'denied' } })
  assert.match(text, /Missing-person manifest: Not available — denied/)
  assert.match(text, /Declared disaster events: Not available — denied/)
  assert.doesNotMatch(text, /open reports at retrieval 0/)
})

test('RDANA without the new sections keeps the previous wording', () => {
  const text = buildRdanaSummary(base())
  assert.match(text, /Deaths, injuries, missing persons, damaged homes/)
  assert.doesNotMatch(text, /Missing-person manifest/)
})

test('DROMIC summary reports manifest values, or Not available / Not assessed', () => {
  const row = (report, label) => report.tables[0].rows.find((r) => r[0] === label)
  const withData = buildDromicReport({ ...base(), missingReports: available(manifestRows), declaredEvents: available(eventRows) }, '', null)
  assert.equal(row(withData, 'Open missing-person reports (at retrieval)')[1], 2)
  assert.equal(row(withData, 'Missing-person reports filed in period')[1], 1)
  assert.equal(row(withData, 'Declared disaster events active in period')[1], 1)
  assert.deepEqual(withData.tables.map((t) => t.name), ['Summary', 'Population', 'Shelters', 'Relief'])
  const failed = buildDromicReport({ ...base(), missingReports: { available: false, reason: 'denied' } }, '', null)
  assert.equal(row(failed, 'Open missing-person reports (at retrieval)')[1], 'Not available')
  assert.equal(row(failed, 'Open missing-person reports (at retrieval)')[2], 'denied')
  const legacy = buildDromicReport(base(), '', null)
  assert.equal(row(legacy, 'Open missing-person reports (at retrieval)')[1], 'Not assessed')
})
