import test from 'node:test'
import assert from 'node:assert/strict'
import { makeReportWindow, inReportWindow, buildRdanaSummary, readReportPages } from '../src/utils/rdana.ts'

const end = '2026-10-14T04:00:00Z'
const window = makeReportWindow(24, end)
const available = (data) => ({ available: true, data })
const unavailable = { available: false, reason: 'Query failed' }
const fixture = () => ({
  window, scope: 'Sitio 1', fetchedAt: '2026-10-14T04:00:05Z',
  residents: [{ uid: 'a', birthdate: '1966-10-14', mobility_status: 'non_ambulatory' },
    { uid: 'b', birthdate: '2026-01-01', mobility_status: 'ambulatory' }],
  sos: available([]), loggedEvacuations: available([]), completedEvacuations: available([]),
  profiles: available([{ resident_uid: 'a', is_pregnant: false, household_id: 'h1', vulnerability_needs: 'Equipment' },
    { resident_uid: 'b', is_pregnant: false, household_id: 'h1', vulnerability_needs: '' }]),
  disabilityResidents: available(['a', 'a']),
  shelters: available([{ center_id: 1, status: 'active', capacity: 10, occupied: 12 },
    { center_id: 2, status: 'active', capacity: 20, occupied: 2 },
    { center_id: 3, status: 'closed', capacity: 100, occupied: 0 },
    { center_id: 4, status: 'active', capacity: null, occupied: 1 }]),
})
test('exact 24/48-hour windows and inclusive/exclusive boundaries', () => {
  assert.equal(Date.parse(window.end) - Date.parse(window.start), 24 * 3600000)
  const long = makeReportWindow(48, end)
  assert.equal(Date.parse(long.end) - Date.parse(long.start), 48 * 3600000)
  assert.equal(inReportWindow(window.start, window), true)
  assert.equal(inReportWindow(window.end, window), false)
  assert.equal(inReportWindow(null, window), false)
  assert.equal(inReportWindow('invalid', window), false)
  assert.throws(() => makeReportWindow(12, end))
})
test('deduplicates alerts and distinguishes event counts from resident accounts', () => {
  const data = fixture()
  const alert = { alert_id: '1', resident_uid: 'a', status: 'active', created_at: window.start }
  data.sos = available([alert, alert, { ...alert, alert_id: '2' }, { ...alert, alert_id: '3', created_at: window.end }])
  const text = buildRdanaSummary(data)
  assert.match(text, /SOS alerts created: 2; distinct reporting resident accounts: 1/)
})
test('completion timestamps, not logging time, determine completion-window counts', () => {
  const data = fixture()
  const row = { record_id: '1', resident_uid: 'a', evac_status: 'safely_evacuated', logged_at: '2026-10-01T00:00:00Z', evacuated_at: window.start }
  data.loggedEvacuations = available([row])
  data.completedEvacuations = available([row, row, { ...row, record_id: '2', evacuated_at: null }, { ...row, record_id: '3', evac_status: 'failed' }])
  const text = buildRdanaSummary(data)
  assert.match(text, /Evacuation records logged: 0/)
  assert.match(text, /completion timestamps in the period: 1; distinct resident accounts: 1/)
})
test('failed sections remain unavailable rather than generating reassuring zeros', () => {
  const data = fixture()
  data.sos = unavailable; data.shelters = unavailable; data.profiles = unavailable
  const text = buildRdanaSummary(data)
  assert.match(text, /SOS activity: Not available/)
  assert.doesNotMatch(text, /SOS alerts created: 0/)
  assert.match(text, /Shelter snapshot: Not available/)
  assert.match(text, /Pregnancy, household linkage, and supplemental needs: Not available/)
})
test('snapshot scope, shared households, ages and unknown assessments stay explicit', () => {
  const data = fixture()
  data.residents.push({ uid: 'c', birthdate: 'bad', mobility_status: null })
  const text = buildRdanaSummary(data, 'Flood reported; damage pending assessment.')
  assert.match(text, /age 60\+: 1; unknown\/invalid birthdate: 1/)
  assert.match(text, /Age under 1: 1/)
  assert.match(text, /Distinct linked registered households: 1; accounts without household linkage: 1/)
  assert.match(text, /Resident accounts with recorded disability categories: 1/)
  assert.match(text, /accounts without supplemental assessment: 1/)
  assert.match(text, /not independently verified/)
  assert.match(text, /total disaster-affected people\/families: Not assessed/)
})
test('shelter snapshot excludes closed capacity and does not offset available slots against overcrowding', () => {
  const text = buildRdanaSummary(fixture())
  assert.match(text, /active 3; closed 1/)
  assert.match(text, /reviewed capacity across known active facilities: 30; known available slots: 18/)
  assert.match(text, /Active facilities with capacity not set: 1/)
  assert.match(text, /Daily FFP.*Not available in this report/)
})
test('pagination retrieves more than one server page without truncation', async () => {
  const rows = Array.from({ length: 7 }, (_, i) => i)
  const result = await readReportPages((from, to) => Promise.resolve({ data: rows.slice(from, to + 1), error: null }), 3)
  assert.deepEqual(result, rows)
})
test('pagination fails rather than returning a partial success', async () => {
  await assert.rejects(readReportPages(() => Promise.resolve({ data: [1], error: null }), 1, 2), /retrieval limit/)
  await assert.rejects(readReportPages(() => Promise.resolve({ data: null, error: { message: 'denied' } })), /denied/)
  await assert.rejects(readReportPages(() => Promise.resolve({ data: null, error: null })), /no readable result/)
})
