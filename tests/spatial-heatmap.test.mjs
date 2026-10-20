import test from 'node:test'
import assert from 'node:assert/strict'
import { gridCells, incidentPoints, metersPerPixel, rampColor, residentPosition, vulnerabilityPoints } from '../src/utils/spatialHeatmap.ts'

const base = { name: 'R', barangay: 'Barangay 3', constraint: 'Walk Assist', status: 'Verified', floodZone: false, lastUpdated: '',
  mobilityStatus: 'ambulatory', disabilityCount: 0, isPregnant: false, birthdate: '1990-01-01' }
const r = (id, lat, lng, extra = {}) => ({ ...base, id, gpsLat: lat, gpsLong: lng, ...extra })

test('positions reject missing, invalid and 0,0 coordinates', () => {
  assert.deepEqual(residentPosition(r('a', '10.3', '123.9')), [10.3, 123.9])
  for (const [lat, lng] of [[null, 1], [undefined, 1], ['x', 1], [0, 0], [95, 1], [1, 200]]) {
    assert.equal(residentPosition(r('a', lat, lng)), null)
  }
})

test('vulnerability weights by VPI and filters by level', () => {
  const residents = [
    r('low', 10.3, 123.9),
    r('bedridden-elder', 10.3, 123.9, { birthdate: '1940-01-01', mobilityStatus: 'non_ambulatory' }),
    r('pregnant', 10.3, 123.9, { isPregnant: true }),
    r('nogps', null, null, { mobilityStatus: 'non_ambulatory' }),
    r('incomplete', 10.3, 123.9, { disabilityCount: undefined, mobilityStatus: 'non_ambulatory' }),
  ]
  const all = vulnerabilityPoints(residents, 'all', '2026-10-14')
  assert.equal(all.unmapped, 1)
  assert.equal(all.incomplete, 1)
  assert.equal(all.points.length, 3) // zero-score resident adds nothing
  assert.equal(all.points[0].weight, 6 / 9)
  assert.equal(vulnerabilityPoints(residents, 'high', '2026-10-14').points.length, 1)
  assert.equal(vulnerabilityPoints(residents, 'moderate-high', '2026-10-14').points.length, 3)
})

test('incidents respect the time window but keep current-state items', () => {
  const now = Date.parse('2026-10-14T12:00:00Z')
  const residents = [r('a', 10.3, 123.9), r('b', 10.31, 123.91), r('c', null, null)]
  const inputs = {
    latestStatus: [
      { uid: 'a', status: 'failed', loggedAt: '2026-10-14T10:00:00Z' },
      { uid: 'b', status: 'pending', loggedAt: '2026-10-10T10:00:00Z' },
      { uid: 'c', status: 'failed', loggedAt: '2026-10-14T11:00:00Z' },
      { uid: 'a', status: 'safely_evacuated', loggedAt: '2026-10-14T11:00:00Z' },
    ],
    openReports: [{ residentUid: 'b' }, { residentUid: null }],
    sosAlerts: [{ residentUid: 'a', level: 3, status: 'active', createdAt: '2026-10-14T11:30:00Z' },
      { residentUid: 'a', level: 3, status: 'resolved', createdAt: '2026-10-14T11:30:00Z' }],
    events: [{ lat: 10.32, lng: 123.92, status: 'active' }, { lat: null, lng: null, status: 'active' }, { lat: 1, lng: 1, status: 'resolved' }],
  }
  const day = incidentPoints(residents, inputs, 24, now)
  assert.deepEqual(day.points.map(p => p.kind).sort(), ['disasterEvent', 'failedRescue', 'missingReport', 'sos'])
  assert.equal(day.unmapped, 2) // resident c without GPS, report without a linked resident
  assert.equal(day.points.find(p => p.kind === 'sos').weight, 0.8)
  const all = incidentPoints(residents, inputs, null, now)
  assert.ok(all.points.some(p => p.kind === 'pending'))
})

test('grid bins nearby points and normalises intensity', () => {
  const pts = [
    { lat: 10.3200, lng: 123.9000, weight: 1, kind: 'x' },
    { lat: 10.3201, lng: 123.9001, weight: 0.5, kind: 'y' },
    { lat: 10.3300, lng: 123.9100, weight: 0.5, kind: 'x' },
  ]
  const cells = gridCells(pts, 250)
  assert.equal(cells.length, 2)
  const top = cells[cells.length - 1]
  assert.equal(top.count, 2)
  assert.equal(top.intensity, 1)
  assert.deepEqual(top.kinds, { x: 1, y: 1 })
  assert.ok(top.north - top.south > 0.0022 && top.north - top.south < 0.0023)
  assert.deepEqual(gridCells([]), [])
})

test('ramp and scale helpers', () => {
  assert.equal(rampColor('incidents', 0), '#fde3d6')
  assert.equal(rampColor('incidents', 1), '#7a260a')
  assert.equal(rampColor('vulnerability', 2), '#2e2370')
  assert.ok(Math.abs(metersPerPixel(0, 0) - 156543.03) < 0.1)
})

test('circles merge co-located points and normalise intensity', async () => {
  const { mergePoints } = await import('../src/utils/spatialHeatmap.ts')
  const merged = mergePoints([
    { lat: 10.32, lng: 123.9, weight: 1, kind: 'failedRescue' },
    { lat: 10.32, lng: 123.9, weight: 1, kind: 'missingReport' },
    { lat: 10.33, lng: 123.91, weight: 0.5, kind: 'pending' },
  ])
  assert.equal(merged.length, 2)
  assert.deepEqual(merged.map(c => c.intensity), [0.25, 1])
  assert.deepEqual(merged[1].kinds, { failedRescue: 1, missingReport: 1 })
  assert.deepEqual(mergePoints([]), [])
})
