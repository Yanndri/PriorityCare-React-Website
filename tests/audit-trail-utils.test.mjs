import test from 'node:test'
import assert from 'node:assert/strict'
import { filterTimeline, formatPht, phtDayStart, timelineCsv, timelineFileName, timelineRows, valueLabel } from '../src/utils/auditTrail.ts'

const ev = (o) => ({ occurred_at: '2026-10-14T02:00:00Z', category: 'evacuation', action: 'Evacuation status logged', subject: 'Juan Dela Cruz',
  sitio_id: 1, from_value: 'pending', to_value: 'safely_evacuated', actor_name: 'Rico Rescuer', actor_role: 'rescuer',
  details: 'Center: Central School', ref_id: 'r1', ...o })
const events = [ev({}), ev({ category: 'facility', sitio_id: null, subject: 'Central School', action: 'Center status changed', actor_name: null, details: '=cmd()' }),
  ev({ category: 'sos', sitio_id: 2, subject: 'Liza Gomez' })]
const name = id => `Sitio ${id}`

test('formats Philippine time and day starts', () => {
  assert.equal(formatPht('2026-10-14T16:05:09Z'), '2026-10-15 00:05:09')
  assert.equal(formatPht('bad'), '')
  assert.equal(phtDayStart('2026-10-14').toISOString(), '2026-10-13T16:00:00.000Z')
  assert.throws(() => phtDayStart('14/10/2026'))
})

test('filters by category, sitio (0 = facility-wide) and search', () => {
  const all = ['evacuation', 'facility', 'sos']
  assert.equal(filterTimeline(events, { categories: all, sitioId: null, search: '' }).length, 3)
  assert.equal(filterTimeline(events, { categories: ['evacuation'], sitioId: null, search: '' }).length, 1)
  assert.deepEqual(filterTimeline(events, { categories: all, sitioId: 0, search: '' }).map(e => e.category), ['facility'])
  assert.deepEqual(filterTimeline(events, { categories: all, sitioId: 2, search: '' }).map(e => e.subject), ['Liza Gomez'])
  assert.equal(filterTimeline(events, { categories: all, sitioId: null, search: 'rico' }).length, 2)
})

test('rows and CSV are readable and injection-safe', () => {
  const rows = timelineRows(events, name)
  assert.deepEqual(rows[0].slice(0, 8), ['2026-10-14 10:00:00', 'Evacuation status', 'Evacuation status logged', 'Juan Dela Cruz', 'Sitio 1', 'Pending', 'Safely evacuated', 'Rico Rescuer'])
  assert.equal(rows[1][4], 'All (facility-wide)')
  assert.equal(rows[1][7], 'Not recorded')
  assert.equal(valueLabel('weird'), 'weird')
  const csv = timelineCsv(events, name, { scope: 'Sitio One', from: '2026-10-13T16:00:00Z', to: '2026-10-14T16:00:00Z', generatedAt: '2026-10-14T05:00:00Z' })
  assert.ok(csv.startsWith('﻿"PriorityCare operational timestamp log"'))
  assert.ok(csv.includes('"\'=cmd()"'))
  assert.equal(csv.split('\r\n').length, 7 + 3)
  assert.equal(timelineFileName('2026-10-13T16:00:00Z', '2026-10-15T16:00:00Z', 'csv'), 'prioritycare-audit-log_2026-10-14_to_2026-10-15.csv')
})
