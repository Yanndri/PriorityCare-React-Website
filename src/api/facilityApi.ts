import { supabase } from '../lib/supabaseClient'
import { validateFacility, validateCapacity, type FacilityInput } from '../utils/facility'
function facilityError(error: { code?: string; message: string }) {
  return new Error(error.code === 'PGRST202' ? 'Facility registration needs the 20261014_facility_registration.sql database migration.' : error.message)
}
export async function registerFacility(input: FacilityInput, barangayId?: number | null) {
  const validation = validateFacility(input)
  if (validation) throw new Error(validation)
  const { data, error } = await supabase.rpc('register_evacuation_facility', {
    p_name: input.name.trim(), p_type: input.type, p_lat: input.latitude, p_long: input.longitude, p_capacity: input.capacity,
    // Only super admins pick a barangay; null means municipal-wide. Admins always register in their own.
    ...(barangayId !== undefined ? { p_barangay_id: barangayId } : {}),
  })
  if (error) throw facilityError(error)
  return data as number
}
export async function setFacilityCapacity(id: number | string, capacity: number, expectedCapacity: number | null) {
  const validation = validateCapacity(capacity)
  if (validation) throw new Error(validation)
  const { error } = await supabase.rpc('set_evacuation_facility_capacity', { p_center_id: id, p_capacity: capacity, p_expected_capacity: expectedCapacity })
  if (error) throw facilityError(error)
}
export async function changeFacilityStatus(id: number | string, status: 'active' | 'closed', reason: string, expectedStatus: 'active' | 'closed') {
  if (!reason.trim() || reason.trim().length > 1000) throw new Error('Enter a reason of 1–1,000 characters.')
  const { error } = await supabase.rpc('change_evacuation_facility_status', {
    p_center_id: id, p_status: status, p_reason: reason.trim(), p_expected_status: expectedStatus,
  })
  if (error) throw new Error(error.code === 'PGRST202'
    ? 'Center closure needs the 20261014_facility_lifecycle.sql database migration.' : error.message)
}
