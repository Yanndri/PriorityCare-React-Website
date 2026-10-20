import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTriagePins, scoreDependent, TRIAGE_LEVELS } from '../src/utils/triagePins.ts'
import { DEFAULT_VPI_RULES } from '../src/utils/vpi.ts'

const asOf = '2026-10-17'
const base = { barangay: 'Barangay 3', constraint: 'Walk Assist', status: 'Verified', floodZone: false, lastUpdated: '',
  mobilityStatus: 'ambulatory', disabilityCount: 0, isPregnant: false, birthdate: '1990-01-01', gpsLat: 10.32, gpsLong: 123.9 }
const r = (id, extra = {}) => ({ ...base, id, name: `Person ${id}`, ...extra })

test('one pin per household, coloured by its most urgent member', () => {
  const { pins, counts } = buildTriagePins([
    r('head', { householdId: 'h1', householdName: 'Mercado', isHouseholdHead: true, gpsLat: 10.5, gpsLong: 123.5 }),
    r('elder', { householdId: 'h1', householdName: 'Mercado', birthdate: '1940-01-01', mobilityStatus: 'non_ambulatory', gpsLat: 10.6, gpsLong: 123.6 }),
    r('solo-low'),
    r('solo-mod', { isPregnant: true }),
  ], DEFAULT_VPI_RULES, asOf)
  assert.equal(pins.length, 3)
  const hh = pins.find(p => p.key === 'hh:h1')
  assert.equal(hh.triage, 'red')
  assert.equal(hh.score, 6)
  assert.deepEqual(hh.position, [10.5, 123.5]) // head's location
  assert.equal(hh.positionSource, 'head')
  assert.equal(hh.members[0].name, 'Person elder')
  assert.deepEqual(counts, { red: 1, yellow: 1, green: 1 })
  assert.equal(pins.at(-1).triage, 'red') // drawn last = on top
  assert.equal(pins.find(p => p.key === 'r:solo-mod').triage, 'yellow')
  assert.equal(pins.find(p => p.key === 'r:solo-low').incomplete, false)
})

test('dependents without accounts count, and mark the household incomplete', () => {
  const deps = [{ name: 'Baby', relationship: 'Granddaughter', birthdate: '2024-05-01', sex: 'female', is_pregnant: false, needs: '' }]
  const { pins } = buildTriagePins([r('a', { householdId: 'h2', householdMembers: deps })], DEFAULT_VPI_RULES, asOf)
  assert.equal(pins[0].score, 2)
  assert.equal(pins[0].triage, 'green')
  assert.equal(pins[0].incomplete, true)
  const baby = pins[0].members.find(m => !m.hasAccount)
  assert.deepEqual(baby.factors, ['Under 5 years (+2)'])
  assert.equal(scoreDependent({ birthdate: '2000-01-01', is_pregnant: true }, DEFAULT_VPI_RULES, asOf).score, 3)
  assert.ok(scoreDependent({}, DEFAULT_VPI_RULES, asOf).missing.includes('valid birthdate'))
})

test('incomplete profiles are scored on known factors; known High stays red', () => {
  const { pins, incomplete } = buildTriagePins([
    r('x', { disabilityCount: undefined, mobilityStatus: 'non_ambulatory', birthdate: '1940-01-01' }),
    r('y', { isPregnant: undefined }),
  ], DEFAULT_VPI_RULES, asOf)
  assert.equal(pins.find(p => p.key === 'r:x').triage, 'red')
  assert.equal(pins.find(p => p.key === 'r:y').triage, 'green')
  assert.equal(incomplete, 2)
})

test('households with no GPS are counted, not guessed; a member with GPS is used when the head has none', () => {
  const { pins, unmappedHouseholds } = buildTriagePins([
    r('nogps', { gpsLat: null, gpsLong: null }),
    r('zero', { gpsLat: 0, gpsLong: 0 }),
    r('head', { householdId: 'h3', isHouseholdHead: true, gpsLat: '', gpsLong: '' }),
    r('kid', { householdId: 'h3', gpsLat: '10.1', gpsLong: '123.1' }),
  ], DEFAULT_VPI_RULES, asOf)
  assert.equal(unmappedHouseholds, 2)
  assert.equal(pins.length, 1)
  assert.deepEqual(pins[0].position, [10.1, 123.1])
  assert.equal(pins[0].positionSource, 'member')
  assert.equal(pins[0].unmappedMembers, 1)
  assert.equal(Object.keys(TRIAGE_LEVELS).length, 3)
})
