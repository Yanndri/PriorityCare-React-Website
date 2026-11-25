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

// Staff registering a resident on their behalf (Module 1). Uses the same
// register-resident Edge Function as app sign-up, so the resident signs in to
// the app with this contact number and PIN.
export type ResidentRegistrationInput = {
  f_name: string
  m_name: string
  l_name: string
  contact_no: string
  sex: 'male' | 'female'
  birthdate: string
  mobility_status: ResidentProfileInput['mobility_status']
  emerg_contact_name: string
  emerg_contact_no: string
  barangay_id: number
  sitio: string
  address: string
  landmark: string
  gps_lat: string
  gps_long: string
  is_pregnant: boolean
  vulnerability_needs: string
  disability_ids: number[]
  household: { household_name: string }
}

export async function registerResident(form: ResidentRegistrationInput, pin: string) {
  const { data, error } = await supabase.functions.invoke<{ uid: string; household_id: string; error?: string }>(
    'register-resident',
    { body: { ...form, pin } },
  )
  if (error) {
    // The function answers 4xx with { error }; show that instead of the generic HTTP message.
    const context = (error as { context?: Response }).context
    const body = context ? await context.json().catch(() => null) as { error?: string } | null : null
    throw new Error(body?.error ?? error.message)
  }
  if (!data?.uid) throw new Error(data?.error ?? 'The resident could not be registered.')
  return data
}

export async function fetchDisabilityTypes() {
  const { data, error } = await supabase.from('disability_types').select('disability_id,disability_name').order('disability_name')
  if (error) throw error
  return (data ?? []) as { disability_id: number; disability_name: string }[]
}

// Forgot PIN / password: staff set a new random one through the reset-password Edge Function
// and hand it over in person. Residents get a 6-digit PIN; responders and admins a password.
export async function resetLogin(uid: string) {
  const { data, error } = await supabase.functions.invoke<{ role: string; kind: 'pin' | 'password'; secret: string; error?: string }>(
    'reset-password',
    { body: { uid } },
  )
  if (error) {
    const context = (error as { context?: Response }).context
    const body = context ? await context.json().catch(() => null) as { error?: string } | null : null
    if (!body && context?.status === 404) throw new Error('The reset-password function is not deployed yet.')
    throw new Error(body?.error ?? error.message)
  }
  if (!data?.secret) throw new Error(data?.error ?? 'The login could not be reset.')
  return data
}

// ID checked in person by staff (Register resident on the website).
// Migration 20261124_02_staff_id_documents.sql: staff may upload into the resident's
// verification-docs folder and save the ID record through staff_add_verification_document.
export type DocumentType = { type_id: number; type_name: string; code: string }

export async function fetchDocumentTypes() {
  const { data, error } = await supabase.from('document_types').select('type_id,type_name,code').order('type_id')
  if (error) throw error
  // Medical certificates are out of scope (no medical conditions are recorded).
  return ((data ?? []) as DocumentType[]).filter((t) => t.code !== 'medical')
}

export async function addStaffIdDocument(uid: string, typeId: number, idNumber: string, photo: File | null, approved: boolean) {
  let path = ''
  if (photo) {
    const ext = photo.type === 'image/png' ? 'png' : 'jpg'
    path = `${uid}/id-${Date.now()}.${ext}`
    const { error: uploadError } = await supabase.storage.from('verification-docs')
      .upload(path, photo, { contentType: photo.type || 'image/jpeg', upsert: false })
    if (uploadError) throw new Error(`The ID photo could not be uploaded (${uploadError.message}).`)
  }
  const { error } = await supabase.rpc('staff_add_verification_document', {
    p_uid: uid, p_type_id: typeId, p_id_number: idNumber.trim(), p_path: path, p_approved: approved,
  })
  if (error) {
    throw new Error(error.code === 'PGRST202'
      ? 'Saving the ID needs the 20261124_02_staff_id_documents.sql database migration.'
      : error.message)
  }
}

// Remove an ID added by mistake: the record and its photo (migration 20261125_01_staff_remove_id_document.sql).
// The removal (who, when, which ID) stays in the Activity Log.
export async function removeIdDocument(docId: number | string) {
  const { data, error } = await supabase.rpc('staff_remove_verification_document', { p_doc_id: Number(docId) })
  if (error) {
    throw new Error(error.code === 'PGRST202'
      ? 'Removing an ID needs the 20261125_01_staff_remove_id_document.sql database migration.'
      : error.message)
  }
  const path = typeof data === 'string' ? data : ''
  // The record is already gone; a photo left behind is only unused storage, so don't fail on it.
  if (path) await supabase.storage.from('verification-docs').remove([path]).catch(() => undefined)
}
