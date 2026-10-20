import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateVpi, DEFAULT_VPI_RULES, validateVpiRules } from '../src/utils/vpi.ts'

const date = '2026-10-14'
const base = {
  id: 'test', name: 'Test Resident', barangay: 'Barangay 1', constraint: 'Walk Assist',
  status: 'Verified', floodZone: false, lastUpdated: '', birthdate: '1990-01-01',
  mobilityStatus: 'ambulatory', disabilityCount: 0, isPregnant: false,
}
const score = (changes = {}, rules = DEFAULT_VPI_RULES, asOf = date) => calculateVpi({ ...base, ...changes }, rules, asOf)

test('complete profile without scored factors is zero, with a maximum of 9', () => {
  assert.equal(score().score, 0)
  assert.equal(score().maxScore, 9)
  assert.equal(score().level, 'Low')
})
test('age bands change on birthdays, not at the start of a year', () => {
  assert.equal(score({ birthdate: '1966-10-15' }).score, 0)
  assert.equal(score({ birthdate: '1966-10-14' }).score, 2)
  assert.equal(score({ birthdate: '2021-10-15' }).score, 2)
  assert.equal(score({ birthdate: '2021-10-14' }).score, 0)
  assert.equal(score({ birthdate: '1966-10-15' }, DEFAULT_VPI_RULES, '2026-10-15').score, 2)
})
test('invalid and future birthdates yield incomplete assessment', () => {
  for (const birthdate of [undefined, 'Jun 15', '2026-02-30', '2027-01-01', '']) {
    assert.equal(score({ birthdate }).level, 'Incomplete')
  }
  assert.notEqual(score({ birthdate: '2000-02-29' }).level, 'Incomplete')
})
test('mobility and disability contributions do not double count', () => {
  const result = score({ mobilityStatus: 'non_ambulatory', disabilityCount: 3 })
  assert.equal(result.score, 4)
  assert.equal(result.factors.length, 1)
  assert.equal(score({ mobilityStatus: 'semi_ambulatory', disabilityCount: 2 }).score, 2)
  assert.equal(score({ disabilityCount: 1 }).score, 2)
})
test('bands include their threshold and maximum score is reachable', () => {
  assert.equal(score({ isPregnant: true }).level, 'Moderate')
  const high = score({ birthdate: '1950-01-01', mobilityStatus: 'non_ambulatory' })
  assert.equal(high.score, 6)
  assert.equal(high.level, 'High')
  assert.equal(score({ birthdate: '1950-01-01', mobilityStatus: 'non_ambulatory', isPregnant: true }).score, 9)
})
test('unknown assessments are not treated as confirmed absence', () => {
  for (const missing of [{ mobilityStatus: undefined }, { disabilityCount: undefined }, { isPregnant: undefined }]) {
    const result = score(missing)
    assert.equal(result.level, 'Incomplete')
    assert.equal(result.missing.length, 1)
  }
})
test('verification, GPS, free-text needs and household size do not affect individual score', () => {
  assert.deepEqual(score({ status: 'Pending', floodZone: true, gpsLat: 10, gpsLong: 123,
    vulnerabilityNeeds: 'Medical note', householdMembers: [{ is_pregnant: true }] }), score())
})
test('custom rules update points, bands and maximum consistently', () => {
  const rules = { ...DEFAULT_VPI_RULES, pregnancy: 8, moderateAt: 4, highAt: 8 }
  const result = score({ isPregnant: true }, rules)
  assert.equal(result.score, 8)
  assert.equal(result.level, 'High')
  assert.equal(result.maxScore, 14)
})
test('invalid configuration is rejected', () => {
  for (const rules of [{ ...DEFAULT_VPI_RULES, age: NaN }, { ...DEFAULT_VPI_RULES, age: -1 },
    { ...DEFAULT_VPI_RULES, age: 1.5 }, { ...DEFAULT_VPI_RULES, highAt: 3 },
    { ...DEFAULT_VPI_RULES, moderateAt: 0 }, {}]) {
    assert.ok(validateVpiRules(rules))
    assert.throws(() => score({}, rules))
  }
})
