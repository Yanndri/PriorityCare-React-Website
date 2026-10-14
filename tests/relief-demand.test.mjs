import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateReliefDemand, validateReliefRates, validateReliefPopulation, reliefCsvCell } from '../src/utils/reliefDemand.ts'

// Illustrative arithmetic fixtures, not recommended distribution rates.
const rates = { ffpPerHousehold: 1, waterPerPerson: 2.5, kitsPerHousehold: 0.2 }
const none = { ffps: 0, waterLiters: 0, hygieneKits: 0 }

test('uses households for packs/kits and people for potable water', () => {
  const demand = calculateReliefDemand({ people: 101, households: 20 }, rates, none)
  assert.deepEqual(demand.gross, { ffps: 20, waterLiters: 253, hygieneKits: 4 })
  assert.deepEqual(demand.request, demand.gross)
})
test('deducts available stock without negative requests', () => {
  const demand = calculateReliefDemand({ people: 101, households: 20 }, rates, { ffps: 8, waterLiters: 300, hygieneKits: 1 })
  assert.deepEqual(demand.request, { ffps: 12, waterLiters: 0, hygieneKits: 3 })
})
test('rounding uses scaled rates rather than binary floating point artifacts', () => {
  const result = calculateReliefDemand({ people: 70, households: 7 }, { ffpPerHousehold: 0.1, waterPerPerson: 0.1, kitsPerHousehold: 0.1 }, none)
  assert.deepEqual(result.gross, { ffps: 1, waterLiters: 7, hygieneKits: 1 })
})
test('zero population and explicit zero rate are supported', () => {
  assert.deepEqual(calculateReliefDemand({ people: 0, households: 0 }, rates, none).gross, none)
  assert.equal(calculateReliefDemand({ people: 10, households: 2 }, { ...rates, kitsPerHousehold: 0 }, none).gross.hygieneKits, 0)
})
test('unknown population is not silently interpreted as zero', () => {
  for (const population of [{ people: NaN, households: 2 }, { people: 10, households: NaN }]) {
    assert.ok(validateReliefPopulation(population))
    assert.throws(() => calculateReliefDemand(population, rates, none))
  }
})
test('rejects inconsistent counts and fractional people', () => {
  for (const population of [{ people: 10, households: 11 }, { people: 10, households: 0 },
    { people: 0, households: 1 }, { people: -1, households: 0 }, { people: 1.5, households: 1 }]) {
    assert.ok(validateReliefPopulation(population))
  }
})
test('all rates are required and precision/range constraints are enforced', () => {
  for (const invalid of [{}, { ...rates, waterPerPerson: NaN }, { ...rates, waterPerPerson: -1 },
    { ...rates, waterPerPerson: Infinity }, { ...rates, waterPerPerson: 1.2345 }, { ...rates, waterPerPerson: 10001 }]) {
    assert.ok(validateReliefRates(invalid))
    assert.throws(() => calculateReliefDemand({ people: 10, households: 2 }, invalid, none))
  }
})
test('invalid stock cannot produce a misleading net request', () => {
  for (const invalid of [NaN, -1, 1.5, Infinity]) {
    assert.throws(() => calculateReliefDemand({ people: 10, households: 2 }, rates, { ...none, ffps: invalid }))
  }
})
test('rounding per center preserves each center’s allocation', () => {
  const a = calculateReliefDemand({ people: 1, households: 1 }, { ...rates, ffpPerHousehold: 0.1 }, none)
  const b = calculateReliefDemand({ people: 1, households: 1 }, { ...rates, ffpPerHousehold: 0.1 }, none)
  assert.equal(a.request.ffps + b.request.ffps, 2)
})
test('CSV quotes facility names and protects spreadsheet formula cells', () => {
  assert.equal(reliefCsvCell('Hall "A", north'), '"Hall ""A"", north"')
  assert.equal(reliefCsvCell('=1+1'), '"\'=1+1"')
  assert.equal(reliefCsvCell(' @SUM(A1)'), '"\' @SUM(A1)"')
  assert.equal(reliefCsvCell(20), '"20"')
})
