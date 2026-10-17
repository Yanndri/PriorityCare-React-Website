import { supabase } from '../lib/supabaseClient'

export type EvacStatus = 'pending' | 'in_transit' | 'safely_evacuated' | 'failed'

export type EvacueePerson = {
  uid: string
  full_name: string
  sex: string | null
  age: number | null
  home_sitio: string | null
  latest_status: EvacStatus | null
  latest_logged_at: string | null
  evacuated_at: string | null
  center_id: number | null
  center_name: string | null
  center_status: string | null
  household_id: string | null
  household_name: string | null
  open_missing_report: boolean
}

export type CenterSummary = { center_id: number; center_name: string; status: string | null; sheltered: number }

export type EvacueeSearchResult = {
  generated_at: string
  has_more: boolean
  people: EvacueePerson[]
  centers: CenterSummary[]
}

export type HouseholdMember = {
  uid: string
  full_name: string
  sex: string | null
  age: number | null
  is_head: boolean
  home_sitio: string | null
  latest_status: EvacStatus | null
  latest_logged_at: string | null
  center_id: number | null
  center_name: string | null
  open_missing_report: boolean
}

export type EvacueeHousehold = {
  household_id: string | null
  household_name: string | null
  members: HouseholdMember[]
  dependents: { name: string | null; relationship: string | null; sex: string | null; birthdate: string | null }[]
}

function lookupError(error: { code?: string; message: string }) {
  return new Error(error.code === 'PGRST202'
    ? 'Family reunification lookup needs the 20261017_family_reunification_lookup.sql database migration.'
    : error.message)
}

export async function searchEvacuees(query: string, centerId: number | null): Promise<EvacueeSearchResult> {
  const { data, error } = await supabase.rpc('search_evacuees', { p_query: query.trim(), p_center_id: centerId })
  if (error) throw lookupError(error)
  return data as EvacueeSearchResult
}

export async function getEvacueeHousehold(residentUid: string): Promise<EvacueeHousehold> {
  const { data, error } = await supabase.rpc('get_evacuee_household', { p_resident_uid: residentUid })
  if (error) throw lookupError(error)
  return data as EvacueeHousehold
}
