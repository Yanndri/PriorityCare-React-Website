import test from 'node:test'
import assert from 'node:assert/strict'
import { catchmentLines, haversineKm, shelterLoad, sitioPopulation, validatePlan } from '../src/utils/shelterCatchments.ts'

const center = (id, extra = {}) => ({ center_id: id, center_name: `C${id}`, status: 'active', capacity: 50, gps_lat: 10.3, gps_long: 123.9, primary_for: [1], planned_population: 10, ...extra })
const sitio = (id, extra = {}) => ({ sitio_id: id, sitio_name: `S${id}`, editable: true, residents: 4, dependents: 2, centroid_lat: '10.31', centroid_long: '123.91',
  primary_center_id: null, alternate_center_ids: [], note: '', updated_at: null, updated_by_name: null, ...extra })

test('shelter load bands', () => {
  assert.equal(shelterLoad(center(1, { primary_for: [] })).status, 'unused')
  assert.equal(shelterLoad(center(1, { capacity: null })).status, 'unknown')
  assert.equal(shelterLoad(center(1, { planned_population: '40' })).status, 'ok')
  assert.equal(shelterLoad(center(1, { planned_population: 43 })).status, 'near')
  assert.equal(shelterLoad(center(1, { planned_population: 51 })).status, 'over')
  assert.equal(sitioPopulation(sitio(1)), 6)
})

test('lines from sitio centroid to primary and alternates; missing GPS reported', () => {
  const data = { generated_at: '', can_edit_all: false,
    centers: [center(10), center(11, { gps_lat: null }), center(12, { gps_lat: 10.35, gps_long: 123.95 })],
    sitios: [sitio(1, { primary_center_id: 10, alternate_center_ids: [12, 11] }), sitio(2, { primary_center_id: 10, centroid_lat: null }), sitio(3)] }
  const { lines, missing } = catchmentLines(data)
  assert.deepEqual(lines.map(l => [l.sitioId, l.centerId, l.role]), [[1, 10, 'primary'], [1, 12, 'alternate']])
  assert.deepEqual(lines[0].from, [10.31, 123.91])
  assert.equal(missing.length, 2)
  assert.ok(Math.abs(haversineKm([0, 0], [0, 1]) - 111.19) < 0.1)
})

test('client validation mirrors the server', () => {
  const cs = [center(10), center(13, { status: 'closed' })]
  assert.equal(validatePlan(10, [11], cs, ''), '')
  assert.match(validatePlan(null, [11], cs, ''), /primary shelter before/)
  assert.match(validatePlan(10, [10], cs, ''), /only once/)
  assert.match(validatePlan(10, [1, 2, 3, 4], cs, ''), /at most 3/)
  assert.match(validatePlan(13, [], cs, ''), /closed/)
  assert.equal(validatePlan(10, [13], cs, ''), '')
  assert.match(validatePlan(null, [], cs, 'x'.repeat(501)), /500/)
})
