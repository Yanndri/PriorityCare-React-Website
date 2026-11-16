import test from 'node:test'
import assert from 'node:assert/strict'
import { columnOf, elapsed, nextStatus, rankUnits, suggestForResident, ticketLabel } from '../src/utils/dispatch.ts'

const base = { id: 'r', name: 'R', barangay: 'S', constraint: 'Walk Assist', status: 'Verified', floodZone: false, lastUpdated: '',
  mobilityStatus: 'ambulatory', disabilityCount: 0, isPregnant: false, birthdate: '1990-01-01' }

test('status flow and columns', () => {
  assert.equal(nextStatus('assigned'), 'acknowledged')
  assert.equal(nextStatus('en_route'), 'on_scene')
  assert.equal(nextStatus('on_scene'), null)
  assert.deepEqual(['open', 'assigned', 'en_route', 'resolved', 'cancelled'].map(columnOf), ['open', 'assigned', 'active', 'closed', 'closed'])
  assert.equal(ticketLabel({ ticket_no: 7 }), 'D-0007')
})

test('priority and equipment suggestions', () => {
  const asOf = '2026-10-17'
  assert.equal(suggestForResident({ ...base }, null, asOf).priority, 'normal')
  // Household VPI: cannot walk 30 + senior 6 + light house 25 = 61 (Assisted)
  const elder = suggestForResident({ ...base, birthdate: '1940-01-01', mobilityStatus: 'non_ambulatory', houseType: 'light' }, null, asOf)
  assert.equal(elder.priority, 'high')
  const bedriddenFamily = suggestForResident({ ...base, birthdate: '1940-01-01', mobilityStatus: 'non_ambulatory', houseType: 'light',
    householdMembers: [{ name: 'B', relationship: '', birthdate: '2024-05-01', sex: 'female', is_pregnant: false, needs: '' },
      { name: 'M', relationship: '', birthdate: '1998-01-01', sex: 'female', is_pregnant: true, needs: '' }] }, null, asOf)
  assert.equal(bedriddenFamily.priority, 'critical') // 30 + (18 + 8 + 6) + 25 = 87
  assert.deepEqual(elder.equipment.sort(), ['Stretcher / spineboard', 'Wheelchair']) // non-ambulatory + age ≥ 80
  assert.equal(suggestForResident({ ...base, vulnerabilityNeeds: 'needs oxygen' }, null, asOf).equipment[0], 'Oxygen')
  assert.deepEqual(suggestForResident({ ...base, mobilityStatus: 'non_ambulatory' }, null, asOf, []).equipment, []) // no rules, no suggestions
  assert.equal(suggestForResident({ ...base, isPregnant: true, houseType: 'light' }, null, asOf).priority, 'high') // 18 + 25 = 43
  assert.equal(suggestForResident(undefined, 3, asOf).priority, 'critical')
  assert.equal(suggestForResident(undefined, 2, asOf).priority, 'high')
  const withBaby = suggestForResident({ ...base, householdMembers: [{ name: 'B', relationship: '', birthdate: '2024-05-01', sex: 'female', is_pregnant: false, needs: '' }] }, null, asOf)
  assert.deepEqual(withBaby.equipment, ['Infant kit'])
})

test('unit ranking prefers capability coverage, then least busy; skips inactive', () => {
  const u = (id, caps, live, active = true) => ({ unit_id: id, unit_name: `U${id}`, barangay_id: 1, capabilities: caps, member_uids: [], is_active: active, editable: true, members: [], live_tickets: live })
  const ranked = rankUnits([u(1, ['boat'], 0), u(2, ['stretcher'], 3), u(3, ['stretcher', 'boat'], 5), u(4, ['stretcher'], 0, false)], ['Stretcher / spineboard', 'Boat'])
  assert.deepEqual(ranked.map(r => [r.unit.unit_id, r.covered]), [[3, 2], [1, 1], [2, 1]])
  assert.deepEqual(ranked[1].missing, ['Stretcher / spineboard'])
})

test('elapsed', () => {
  const now = Date.parse('2026-10-17T12:00:00Z')
  assert.equal(elapsed('2026-10-17T11:45:00Z', now), '15 min')
  assert.equal(elapsed('2026-10-17T09:30:00Z', now), '2 h 30 min')
  assert.equal(elapsed('2026-10-14T12:00:00Z', now), '3 d')
  assert.equal(elapsed(null, now), '')
})
