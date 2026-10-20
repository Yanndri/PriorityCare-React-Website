import { supabase } from '../lib/supabaseClient'

export type MemberMobility = 'ambulatory' | 'assisted' | 'wheelchair' | 'bedridden'
export type HouseholdMember = {
  member_id?: string
  name: string
  relationship: string
  birthdate: string
  sex: '' | 'male' | 'female'
  is_pregnant: boolean
  needs: string
  mobility?: MemberMobility
  age_group?: '' | 'infant' | 'child' | 'adult' | 'senior'
  disability_ids?: number[]
}
export type ResidentProfileInput = {
  revision: string | null
  household_revision: string | null
  household_id: string
  household_name: string
  f_name: string
  m_name: string
  l_name: string
  contact_no: string
  sex: 'male' | 'female'
  birthdate: string
  mobility_status: 'ambulatory' | 'semi_ambulatory' | 'non_ambulatory'
  emerg_contact_name: string
  emerg_contact_no: string
  gps_lat: number
  gps_long: number
  address: string
  landmark: string
  is_pregnant: boolean
  vulnerability_needs: string
  disability_ids: number[]
  household_members: HouseholdMember[]
}
export type ResidentProfileDetails = {
  profile: ResidentProfileInput
  disability_types: { disability_id: number; disability_name: string }[]
  barangay_name: string
  households: { household_id: string; household_name: string; head_name: string }[]
  registered_members: { uid: string; name: string; is_head: boolean }[]
}
function profileError(error: { code?: string; message: string }) {
  return new Error(error.code === 'PGRST202'
    ? 'Household editing needs the database migration. Ask the project administrator to apply 20261014_resident_profile_editing.sql.'
    : error.message)
}
export async function fetchResidentProfile(residentId: number | string) {
  const { data, error } = await supabase.rpc('get_resident_edit_profile', { p_uid: residentId })
  if (error) throw profileError(error)
  return data as ResidentProfileDetails
}

export async function fetchHousehold(householdId: string) {
  const { data, error } = await supabase.rpc('get_household_edit_details', { p_household_id: householdId })
  if (error) throw profileError(error)
  return data as {
    household_members: HouseholdMember[]
    household_revision: string
    registered_members: ResidentProfileDetails['registered_members']
  }
}
export async function saveResidentProfile(residentId: number | string, profile: ResidentProfileInput) {
  const { error } = await supabase.rpc('update_resident_demographics', { p_uid: residentId, p_profile: profile })
  if (error) throw profileError(error)
}
