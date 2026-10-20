import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_EQUIPMENT_RULES, equipmentDataGaps, matchEquipment } from '../src/utils/equipmentMatch.ts'

const asOf = '2026-10-17'
const base = { id: 'r', name: 'R', barangay: 'S', constraint: 'Walk Assist', status: 'Verified', floodZone: false, lastUpdated: '',
  mobilityStatus: 'ambulatory', disabilityCount: 0, disabilityTypes: [], isPregnant: false, birthdate: '1990-01-01', vulnerabilityNeeds: '' }
const eq = (res, rules) => matchEquipment(res, rules, asOf).map(n => n.equipment).sort()

test('nothing for an ambulatory adult without needs', () => {
  assert.deepEqual(eq({ ...base }), [])
})

test('mobility, disability types, pregnancy and age', () => {
  assert.deepEqual(eq({ ...base, mobilityStatus: 'non_ambulatory' }), ['Stretcher / spineboard'])
  assert.deepEqual(eq({ ...base, disabilityTypes: ['Visual', 'Hearing'] }), ['Guide rope / sighted escort', 'Written cards / light signals'])
  assert.deepEqual(eq({ ...base, isPregnant: true }), ['First aid kit'])
  assert.deepEqual(eq({ ...base, birthdate: '1940-01-01' }), ['Wheelchair'])
  assert.deepEqual(eq({ ...base, birthdate: '2024-01-01' }), ['Infant kit'])
})

test('needs keywords are whole-word and case-insensitive; duplicates merge with all reasons', () => {
  const r = matchEquipment({ ...base, mobilityStatus: 'semi_ambulatory', disabilityTypes: ['Physical'], vulnerabilityNeeds: 'On OXYGEN at night; uses a wheelchair' }, undefined, asOf)
  assert.deepEqual(r.map(n => n.equipment).sort(), ['Oxygen', 'Wheelchair'])
  assert.equal(r.find(n => n.equipment === 'Wheelchair').reasons.length, 3)
  assert.deepEqual(eq({ ...base, vulnerabilityNeeds: 'Lost roof in the hurricane' }), []) // "cane" inside a word
  assert.deepEqual(eq({ ...base, vulnerabilityNeeds: 'Walks with a cane.' }), ['Walking aid'])
})

test('household dependents count, labelled by name', () => {
  const r = matchEquipment({ ...base, householdMembers: [{ name: 'Baby', relationship: 'Granddaughter', birthdate: '2024-05-01', sex: 'female', is_pregnant: false, needs: 'asthma, oxygen' }] }, undefined, asOf)
  assert.deepEqual(r.map(n => n.equipment).sort(), ['Infant kit', 'Oxygen'])
  assert.ok(r[0].reasons[0].startsWith('Baby: '))
})

test('inactive and custom rules', () => {
  const rules = DEFAULT_EQUIPMENT_RULES.map(x => x.match_value === 'non_ambulatory' ? { ...x, is_active: false } : x)
    .concat([{ match_kind: 'needs_keyword', match_value: 'cpap', equipment: 'Oxygen', note: '', is_active: true }])
  assert.deepEqual(eq({ ...base, mobilityStatus: 'non_ambulatory' }, rules), [])
  const cpap = matchEquipment({ ...base, vulnerabilityNeeds: 'CPAP machine' }, rules, asOf)
  assert.deepEqual(cpap[0].reasons, ['Needs text mentions cpap'])
})

test('data gaps are listed', () => {
  assert.deepEqual(equipmentDataGaps({ ...base, disabilityTypes: undefined, isPregnant: undefined, vulnerabilityNeeds: undefined }),
    ['disability assessment', 'pregnancy', 'assistance needs'])
  assert.deepEqual(equipmentDataGaps(undefined), [])
})
