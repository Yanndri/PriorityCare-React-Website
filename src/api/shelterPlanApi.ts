import { supabase } from '../lib/supabaseClient'
import type { ShelterPlanData } from '../utils/shelterCatchments'

function planError(error: { code?: string; message: string }) {
  return new Error(error.code === 'PGRST202'
    ? 'Sitio → shelter assignments need the 20261017_sitio_shelter_catchments.sql database migration.'
    : error.message)
}

export async function getShelterAssignments(): Promise<ShelterPlanData> {
  const { data, error } = await supabase.rpc('get_shelter_assignments')
  if (error) throw planError(error)
  return data as ShelterPlanData
}

export async function setSitioShelters(sitioId: number, primaryId: number | null, alternateIds: number[], note: string) {
  const { error } = await supabase.rpc('set_sitio_shelters', {
    p_sitio: sitioId, p_primary: primaryId, p_alternates: alternateIds, p_note: note.trim(),
  })
  if (error) throw planError(error)
}
