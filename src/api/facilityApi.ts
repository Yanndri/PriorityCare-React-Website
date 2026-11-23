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

// "Went home": everyone at the center (recordId omitted) or one person. Returns how many were marked.
export async function sendCenterHome(id: number | string, recordId?: string) {
  const { data, error } = await supabase.rpc('send_center_home', { p_center_id: id, p_record_id: recordId ?? null })
  if (error) throw new Error(error.code === 'PGRST202' ? 'This needs the STEP17 database update first.' : error.message)
  return Number(data ?? 0)
}

// Name, type and map location (STEP37). Capacity is saved with setFacilityCapacity.
export async function updateFacilityDetails(id: number | string, input: { name: string; type: string; latitude: number; longitude: number }) {
  const { error } = await supabase.rpc('update_evacuation_facility_details', {
    p_center_id: id, p_name: input.name.trim(), p_type: input.type, p_lat: input.latitude, p_long: input.longitude,
  })
  if (error) throw new Error(error.code === 'PGRST202' ? 'Editing the name and location needs STEP37 to be run in the Supabase SQL Editor.' : error.message)
}

// Check in people who came on their own: one record per person (same as the responder app).
export async function admitWalkIn(input: { centerId: number | string; name: string; barangayId: number | null; sitio: string; needs: string }) {
  const { error } = await supabase.rpc('admit_walk_in', {
    p_center_id: input.centerId, p_name: input.name.trim(), p_barangay_id: input.barangayId,
    p_sitio: input.sitio.trim(), p_headcount: 1, p_needs: input.needs.trim(),
  })
  if (error) throw new Error(error.message)
}
