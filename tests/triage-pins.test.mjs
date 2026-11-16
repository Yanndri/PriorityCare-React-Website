import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTriagePins, TRIAGE_LEVELS } from '../src/utils/triagePins.ts'

const asOf = '2026-10-17'
const base = { barangay: 'Barangay 3', constraint: 'Walk Assist', status: 'Verified', floodZone: false, lastUpdated: '',
  mobilityStatus: 'ambulatory', disabilityCount: 0, isPregnant: false, birthdate: '1990-01-01', gpsLat: 10.32, gpsLong: 123.9 }
const r = (id, extra = {}) => ({ ...base, id, name: `Person ${id}`, ...extra })

test('one pin per household, coloured by the household VPI', () => {
  const { pins, counts } = buildTriagePins([
    r('head', { householdId: 'h1', householdName: 'Mercado', isHouseholdHead: true, gpsLat: 10.5, gpsLong: 123.5, houseType: 'light' }),
    r('elder', { householdId: 'h1', householdName: 'Mercado', birthdate: '1940-01-01', mobilityStatus: 'non_ambulatory', gpsLat: 10.6, gpsLong: 123.6,
      householdMembers: [{ name: 'Mia', relationship: 'Daughter', birthdate: '1998-01-01', sex: 'female', is_pregnant: true, needs: '' }] }),
    r('solo-low'),
    r('solo-mid', { isPregnant: true, houseType: 'light' }),
  ], asOf)
  assert.equal(pins.length, 3)
  const hh = pins.find(p => p.key === 'hh:h1')
  assert.equal(hh.score, 30 + 24 + 25) // cannot walk + (pregnant 18, senior 6) + light house
  assert.equal(hh.triage, 'red')
  assert.deepEqual(hh.position, [10.5, 123.5]) // head's location
  assert.equal(hh.positionSource, 'head')
  assert.equal(hh.members[0].name, 'Person elder')
  assert.deepEqual(hh.members[0].tags, ['Cannot walk', 'Senior'])
  assert.deepEqual(counts, { red: 1, yellow: 1, green: 1 })
  assert.equal(pins.at(-1).triage, 'red') // drawn last = on top
  assert.equal(pins.find(p => p.key === 'r:solo-mid').score, 43)
})

test('households with no GPS are counted, not guessed; a member with GPS is used when the head has none', () => {
  const { pins, unmappedHouseholds } = buildTriagePins([
    r('nogps', { gpsLat: null, gpsLong: null }),
    r('zero', { gpsLat: 0, gpsLong: 0 }),
    r('head', { householdId: 'h3', isHouseholdHead: true, gpsLat: '', gpsLong: '' }),
    r('kid', { householdId: 'h3', gpsLat: '10.1', gpsLong: '123.1' }),
  ], asOf)
  assert.equal(unmappedHouseholds, 2)
  assert.equal(pins.length, 1)
  assert.deepEqual(pins[0].position, [10.1, 123.1])
  assert.equal(pins[0].positionSource, 'member')
  assert.equal(pins[0].unmappedMembers, 1)
  assert.equal(Object.keys(TRIAGE_LEVELS).length, 3)
})
