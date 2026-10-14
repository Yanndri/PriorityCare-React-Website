export type ReliefRates = { ffpPerHousehold: number; waterPerPerson: number; kitsPerHousehold: number }
export type ReliefPopulation = { people: number; households: number }
export type ReliefStock = { ffps: number; waterLiters: number; hygieneKits: number }

export function validateReliefRates(rates: ReliefRates) {
  return [rates.ffpPerHousehold, rates.waterPerPerson, rates.kitsPerHousehold].every((value) => Number.isFinite(value) && value >= 0 && value <= 10_000
    && Math.abs(value * 1000 - Math.round(value * 1000)) < 0.000001)
    ? '' : 'Enter all daily supply rates as nonnegative numbers up to 10,000, with at most 3 decimal places.'
}
export function validateReliefPopulation(population: ReliefPopulation) {
  if (![population.people, population.households].every((value) => Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000)) {
    return 'People and households must be whole numbers from 0 to 1,000,000.'
  }
  if (population.households > population.people || (population.people > 0 && population.households === 0)) {
    return 'Enter at least one household for an occupied center; households cannot exceed people.'
  }
  return ''
}
export function calculateReliefDemand(population: ReliefPopulation, rates: ReliefRates, stock: ReliefStock) {
  const error = validateReliefRates(rates) || validateReliefPopulation(population)
  if (error) throw new Error(error)
  if (![stock.ffps, stock.waterLiters, stock.hygieneKits].every((value) => Number.isSafeInteger(value) && value >= 0)) {
    throw new Error('Available stock must be nonnegative whole units or liters.')
  }
  // Three-decimal rates become integers before multiplication to avoid floating point ceiling errors.
  const units = (count: number, rate: number) => Math.ceil(count * Math.round(rate * 1000) / 1000)
  const gross = {
    ffps: units(population.households, rates.ffpPerHousehold),
    waterLiters: units(population.people, rates.waterPerPerson),
    hygieneKits: units(population.households, rates.kitsPerHousehold),
  }
  const request = {
    ffps: Math.max(0, gross.ffps - stock.ffps),
    waterLiters: Math.max(0, gross.waterLiters - stock.waterLiters),
    hygieneKits: Math.max(0, gross.hygieneKits - stock.hygieneKits),
  }
  return { gross, request }
}

export function reliefCsvCell(value: string | number) {
  const text = String(value)
  const safe = /^\s*[=+@-]/.test(text) ? `'${text}` : text
  return `"${safe.replaceAll('"', '""')}"`
}
