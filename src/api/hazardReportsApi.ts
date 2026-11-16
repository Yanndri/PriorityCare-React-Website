import { supabase } from '../lib/supabaseClient'

// Hazards reported from the phone app (residents and rescuers). Row access is limited by RLS to the
// staff member's barangay (the municipal admin sees all); reviewing goes through review_hazard().
export const HAZARD_TYPE_LABELS = {
  FIRE: 'Fire', FLOOD: 'Flood', BLOCK: 'Blocked road or debris', WIRE: 'Live electrical wire',
  LANDSLIDE: 'Landslide', OTHER: 'Other hazard',
} as const
export type HazardTypeCode = keyof typeof HAZARD_TYPE_LABELS
export type HazardStatus = 'unverified' | 'under_review' | 'confirmed' | 'dismissed' | 'resolved'
export const HAZARD_STATUS_LABELS: Record<HazardStatus, string> = {
  unverified: 'Not checked yet', under_review: 'Being checked', confirmed: 'Confirmed',
  dismissed: 'Dismissed', resolved: 'Cleared',
}
export type HazardReport = {
  hazard_id: string; barangay_id: number | null; barangay_name: string | null
  hazard_type: HazardTypeCode; description: string; latitude: number; longitude: number
  status: HazardStatus; reporter_role: string | null; review_note: string | null
  reviewed_at: string | null; created_at: string
}
export type HazardAction = 'confirm' | 'review' | 'dismiss' | 'resolve'

// Open reports, plus ones closed in the last 7 days.
export async function getHazardReports(): Promise<HazardReport[]> {
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
  const { data, error } = await supabase
    .from('hazard_reports')
    .select('hazard_id, barangay_id, hazard_type, description, latitude, longitude, status, reporter_role, review_note, reviewed_at, created_at, barangays(barangay_name)')
    .or(`status.in.(unverified,under_review,confirmed),updated_at.gte.${since}`)
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => {
    const { barangays, ...rest } = row as typeof row & { barangays: { barangay_name: string } | { barangay_name: string }[] | null }
    const b = Array.isArray(barangays) ? barangays[0] : barangays
    return { ...rest, latitude: Number(rest.latitude), longitude: Number(rest.longitude), barangay_name: b?.barangay_name ?? null } as HazardReport
  })
}

export async function reviewHazard(hazardId: string, action: HazardAction, note = '') {
  const { error } = await supabase.rpc('review_hazard', { p_hazard_id: hazardId, p_action: action, p_note: note })
  if (error) throw new Error(error.message)
}
