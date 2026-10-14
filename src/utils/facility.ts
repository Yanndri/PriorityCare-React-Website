export const FACILITY_TYPES = ['school', 'covered_court', 'barangay_hall', 'church', 'other'] as const
export type FacilityInput = { name: string; type: typeof FACILITY_TYPES[number]; latitude: number; longitude: number; capacity: number }
export function validateCapacity(capacity: number) {
  return Number.isInteger(capacity) && capacity >= 1 && capacity <= 1_000_000
    ? '' : 'Maximum safe capacity must be a whole number from 1 to 1,000,000 people.'
}
export function validateFacility(input: FacilityInput) {
  if (!input.name.trim() || input.name.trim().length > 100) return 'Enter a facility name of 1–100 characters.'
  if (!FACILITY_TYPES.includes(input.type)) return 'Select a valid facility type.'
  if (!Number.isFinite(input.latitude) || input.latitude < -90 || input.latitude > 90) return 'Latitude must be between -90 and 90.'
  if (!Number.isFinite(input.longitude) || input.longitude < -180 || input.longitude > 180) return 'Longitude must be between -180 and 180.'
  return validateCapacity(input.capacity)
}
