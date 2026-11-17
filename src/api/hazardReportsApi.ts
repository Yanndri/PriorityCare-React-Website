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
  event_id: string | null
}
export type HazardAction = 'confirm' | 'review' | 'dismiss' | 'resolve'

// Open reports, plus ones closed in the last 7 days.
export async function getHazardReports(): Promise<HazardReport[]> {
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
  const { data, error } = await supabase
    .from('hazard_reports')
    .select('hazard_id, barangay_id, hazard_type, description, latitude, longitude, status, reporter_role, review_note, reviewed_at, created_at, event_id, barangays(barangay_name)')
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

// Report types that can become a declared disaster (the disaster form only has flood, fire, landslide, earthquake).
export const DECLARABLE: Partial<Record<HazardTypeCode, string>> = { FLOOD: 'Flood', FIRE: 'Fire', LANDSLIDE: 'Landslide' }

// STEP21: declare a disaster straight from a report (type, barangay, pin and time come from the report).
export async function declareFromHazard(hazardId: string, name: string, location: string, notes = '') {
  const { data, error } = await supabase.rpc('declare_disaster_from_hazard', {
    p_hazard_id: hazardId, p_name: name.trim(), p_location: location.trim(), p_notes: notes.trim(),
  })
  if (error) throw new Error(error.code === 'PGRST202' ? 'Run STEP21 in the Supabase SQL Editor first.' : error.message)
  return data as string
}

// STEP21: add a repeat report to a disaster that is already declared.
export async function linkHazardToEvent(hazardId: string, eventId: string) {
  const { error } = await supabase.rpc('link_hazard_to_event', { p_hazard_id: hazardId, p_event_id: eventId })
  if (error) throw new Error(error.code === 'PGRST202' ? 'Run STEP21 in the Supabase SQL Editor first.' : error.message)
}

// STEP24: who reported each hazard (name, role, number) so staff can call them to check.
export type HazardReporter = { hazard_id: string; reporter_name: string | null; reporter_role: string | null; contact_no: string | null; reporter_verified?: boolean }
export async function getHazardReporters(ids: string[]): Promise<Map<string, HazardReporter>> {
  if (!ids.length) return new Map()
  const { data, error } = await supabase.rpc('get_hazard_reporters', { p_ids: ids })
  if (error) return new Map() // STEP24 not run yet: show the role only
  return new Map(((data ?? []) as HazardReporter[]).map((r) => [r.hazard_id, r]))
}

export async function reviewHazard(hazardId: string, action: HazardAction, note = '') {
  const { error } = await supabase.rpc('review_hazard', { p_hazard_id: hazardId, p_action: action, p_note: note })
  if (error) throw new Error(error.message)
}

// Alarm level per open hazard (STEP20): 1 + people nearby who said "I see it too"
// + other reports of the same type within 300 m and 6 hours. 2nd/3rd alarm = probably real.
export type HazardAlarm = { hazard_id: string; alarm_level: number; confirmations: number; nearby_reports: number }
export async function getHazardAlarms(): Promise<Map<string, HazardAlarm>> {
  const { data, error } = await supabase.rpc('get_hazard_alarms')
  if (error) return new Map() // STEP20 not run yet: no alarm levels
  return new Map(((data ?? []) as HazardAlarm[]).map((a) => [a.hazard_id, a]))
}
export const alarmLabel = (level: number) => level >= 3 ? '3rd alarm' : level === 2 ? '2nd alarm' : '1st alarm'
