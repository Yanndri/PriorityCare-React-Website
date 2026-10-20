import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ageOn, nameSimilarity, reconcile, reconciliationCsv, scoreCandidate,
} from '../src/utils/rescueReconciliation.ts'

const asOf = new Date('2026-10-14T04:00:00Z')
const resident = (uid, f, l, extra = {}) => ({
  uid, barangay_id: 1, f_name: f, m_name: null, l_name: l, sex: 'male', birthdate: '1990-05-01',
  latest_status: 'safely_evacuated', latest_logged_at: '2026-10-14T02:00:00Z', evacuated_at: '2026-10-14T02:00:00Z',
  center_id: 10, center_name: 'Central School', ...extra,
})
const report = (id, name, extra = {}) => ({
  report_id: id, barangay_id: 1, event_id: null, resident_uid: null, full_name: name, sex: 'male', approx_age: 36,
  last_seen_location: 'Riverside', last_seen_at: null, reporter_name: 'Neighbor', reporter_contact: '', notes: '',
  status: 'missing', matched_resident_uid: null, reconciled_at: null, reconciliation_note: null,
  reported_at: '2026-10-14T03:00:00Z', ...extra,
})

test('name similarity tolerates order, accents, case, middle names and typos', () => {
  assert.ok(nameSimilarity('Juan Dela Cruz', 'dela cruz, JUAN') > 0.95)
  assert.ok(nameSimilarity('José Rizal', 'Jose Rizal') === 1)
  assert.ok(nameSimilarity('Juan Dela Cruz', 'Juan Santos Dela Cruz') > 0.95)
  assert.ok(nameSimilarity('Maria Santos', 'Marya Santos') > 0.9)
  assert.ok(nameSimilarity('Juan Dela Cruz', 'Pedro Reyes') < 0.75)
  assert.ok(nameSimilarity('Juan', 'Juan Dela Cruz') < 0.9)
  assert.equal(nameSimilarity('', 'Juan'), 0)
})

test('age uses the Philippine calendar date and birthdays', () => {
  assert.equal(ageOn('1990-10-14', asOf), 36)
  assert.equal(ageOn('1990-10-15', asOf), 35)
  // 2026-10-14T20:00Z is already Oct 15 in Manila.
  assert.equal(ageOn('1990-10-15', new Date('2026-10-14T20:00:00Z')), 36)
  assert.equal(ageOn(null, asOf), null)
  assert.equal(ageOn('bad', asOf), null)
})

test('scoring rejects conflicting sex/age and rewards agreement', () => {
  const r = resident('a', 'Juan', 'Dela Cruz')
  assert.ok(scoreCandidate(report('1', 'Juan Dela Cruz'), r, asOf).score >= 95)
  assert.equal(scoreCandidate(report('1', 'Juan Dela Cruz', { sex: 'female' }), r, asOf), null)
  assert.equal(scoreCandidate(report('1', 'Juan Dela Cruz', { approx_age: 8 }), r, asOf), null)
  const unknown = scoreCandidate(report('1', 'Juan Dela Cruz', { sex: null, approx_age: null }), r, asOf)
  assert.ok(unknown.score >= 60 && unknown.score < 85)
  assert.equal(scoreCandidate(report('1', 'Juan Dela Cruz', { resident_uid: 'b' }), r, asOf), null)
  assert.equal(scoreCandidate(report('1', 'Anyone', { resident_uid: 'a' }), r, asOf).score, 100)
})

test('reconcile classifies the manifest and finds unaccounted residents', () => {
  const data = {
    generated_at: asOf.toISOString(),
    barangays: [{ barangay_id: 1, barangay_name: 'Barangay 1' }, { barangay_id: 2, barangay_name: 'Barangay 2' }],
    events: [{ event_id: 'e1', barangay_id: 1, name: 'Flood', hazard_type: 'flood', status: 'active', started_at: '' },
      { event_id: 'e2', barangay_id: 2, name: 'Old', hazard_type: 'fire', status: 'resolved', started_at: '' }],
    residents: [
      resident('juan', 'Juan', 'Dela Cruz'),
      resident('maria', 'Maria', 'Santos', { sex: 'female', latest_status: 'failed', center_name: null }),
      resident('pedro', 'Pedro', 'Reyes', { latest_status: null }),
      resident('ana', 'Ana', 'Lim', { sex: 'female', latest_status: 'in_transit' }),
      resident('liza', 'Liza', 'Gomez', { barangay_id: 2, sex: 'female', latest_status: null }),
      resident('jon', 'Jon', 'Dela Cruz', { birthdate: null }),
    ],
    reports: [
      report('r-linked', 'J. Dela Cruz', { resident_uid: 'juan', reported_at: '2026-10-14T03:30:00Z' }),
      report('r-probable', 'Juan dela Cruz'),
      report('r-none', 'Unknown Child', { sex: 'female', approx_age: 7 }),
      report('r-maria', 'Maria Santos', { resident_uid: 'maria', sex: 'female' }),
      report('r-found', 'Old Case', { status: 'found', reconciliation_note: 'Matched' }),
      report('r-withdrawn', 'Dup', { status: 'withdrawn', reconciliation_note: '=HYPERLINK("x")' }),
    ],
  }
  const result = reconcile(data, asOf)
  assert.deepEqual(result.open.map(o => [o.report.report_id, o.classification]),
    [['r-linked', 'linked-rescued'], ['r-probable', 'probable'], ['r-none', 'no-match'], ['r-maria', 'no-match']])
  assert.equal(result.open[1].candidates[0].resident.uid, 'juan')
  assert.ok(result.open[1].candidates.every(c => c.resident.latest_status === 'safely_evacuated'))
  assert.equal(result.open[3].linkedResident.uid, 'maria')
  assert.deepEqual(result.rescued.map(r => r.uid).sort(), ['jon', 'juan'])
  // Pedro and Ana in active-event barangay 1; Maria is excluded because she is already reported; Liza's barangay has no active event.
  assert.deepEqual(result.unaccounted.map(r => r.uid).sort(), ['ana', 'pedro'])
  assert.deepEqual(result.summary, { rescued: 2, openReports: 4, linkedRescued: 1, probable: 1, possible: 0,
    noMatch: 2, found: 1, withdrawn: 1, unaccounted: 2 })

  const csv = reconciliationCsv(result, id => `Barangay ${id}`)
  assert.ok(csv.startsWith('﻿"Section"'))
  assert.ok(csv.includes('"\'=HYPERLINK(""x"")"'))
  assert.equal(csv.split('\r\n').length, 1 + 4 + 2 + 2 + 2)
})
