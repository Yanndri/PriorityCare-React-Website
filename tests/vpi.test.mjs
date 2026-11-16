import test from 'node:test'
import assert from 'node:assert/strict'
import { ageOn, calculateVPI, countVulnerable, getVPIPriority, vpiBreakdown } from '../src/utils/vpi.ts'

// Same numbers as the app's src/utils/vpi.js.
test('mobility: worst need counts, with a cap', () => {
  assert.equal(calculateVPI({ nonAmbulatoryCount: 1 }), 30)
  assert.equal(calculateVPI({ nonAmbulatoryCount: 2 }), 35)
  assert.equal(calculateVPI({ nonAmbulatoryCount: 5 }), 40)
  assert.equal(calculateVPI({ semiCount: 1 }), 18)
  assert.equal(calculateVPI({ semiCount: 9 }), 26)
  assert.equal(calculateVPI({ nonAmbulatoryCount: 1, semiCount: 3 }), 30) // not added together
})
test('dependents are capped at 35 and house type adds 25 / 12 / 0', () => {
  assert.equal(calculateVPI({ pregnantCount: 1, childrenCount: 5, seniorsCount: 5 }), 35)
  assert.equal(calculateVPI({ childrenCount: 1, seniorsCount: 1 }), 14)
  assert.equal(calculateVPI({ houseType: 'light' }), 25)
  assert.equal(calculateVPI({ houseType: 'mixed' }), 12)
  assert.equal(calculateVPI({ houseType: 'concrete' }), 0)
  assert.equal(calculateVPI({ nonAmbulatoryCount: 9, pregnantCount: 1, childrenCount: 9, seniorsCount: 9, houseType: 'light' }), 100)
})
test('bands: Critical 70+, Assisted 40+, Low below', () => {
  assert.equal(getVPIPriority(70), 'CRITICAL')
  assert.equal(getVPIPriority(69), 'ASSISTED')
  assert.equal(getVPIPriority(40), 'ASSISTED')
  assert.equal(getVPIPriority(39), 'LOW')
  assert.equal(vpiBreakdown({ semiCount: 1, pregnantCount: 1 }, 'mixed').score, 48)
})
test('counting people: app mobility words, age groups and birthdates', () => {
  const asOf = '2026-11-04'
  const c = countVulnerable([
    { mobility: 'semi_ambulatory', birthdate: '1950-06-01' },
    { mobility: 'bedridden', age_group: 'senior' },
    { mobility: 'wheelchair', age_group: 'adult' },
    { age_group: 'infant' },
    { birthdate: '2020-01-01' },
    { age_group: 'adult', is_pregnant: true },
  ], asOf)
  assert.deepEqual(c, { nonAmbulatoryCount: 2, semiCount: 1, childrenCount: 2, seniorsCount: 2, pregnantCount: 1 })
  assert.equal(ageOn('1966-11-05', asOf), 59)
  assert.equal(ageOn('1966-11-04', asOf), 60)
})
