import { supabase } from '../lib/supabaseClient'
import type { ReconciliationData } from '../utils/rescueReconciliation'

export type NewMissingPersonReport = {
  barangayId: number
  eventId: string | null
  residentUid: string | null
  fullName: string
  sex: 'male' | 'female' | null
  approxAge: number | null
  lastSeenLocation: string
  lastSeenAt: string | null
  reporterName: string
  reporterContact: string
  notes: string
}

function reconciliationError(error: { code?: string; message: string }) {
  return new Error(error.code === 'PGRST202'
    ? 'Missing-person reconciliation needs the 20261014_missing_person_reconciliation.sql database migration.'
    : error.message)
}

export async function getRescueReconciliation(): Promise<ReconciliationData> {
  const { data, error } = await supabase.rpc('get_rescue_reconciliation')
  if (error) throw reconciliationError(error)
  return data as ReconciliationData
}

export async function fileMissingPersonReport(input: NewMissingPersonReport) {
  const { data, error } = await supabase.rpc('file_missing_person_report', {
    p_barangay: input.barangayId,
    p_event_id: input.eventId,
    p_resident_uid: input.residentUid,
    p_full_name: input.fullName.trim(),
    p_sex: input.sex,
    p_age: input.approxAge,
    p_last_seen_location: input.lastSeenLocation.trim(),
    p_last_seen_at: input.lastSeenAt,
    p_reporter_name: input.reporterName.trim(),
    p_reporter_contact: input.reporterContact.trim(),
    p_notes: input.notes.trim(),
  })
  if (error) throw reconciliationError(error)
  return data as string
}

/** Confirm a report as found. Pass residentUid to match it to the Master Rescued Directory. */
export async function markMissingPersonFound(reportId: string, residentUid: string | null, note: string) {
  const { error } = await supabase.rpc('mark_missing_person_found', {
    p_report_id: reportId, p_resident_uid: residentUid, p_note: note.trim(),
  })
  if (error) throw reconciliationError(error)
}

export async function withdrawMissingPersonReport(reportId: string, reason: string) {
  const { error } = await supabase.rpc('withdraw_missing_person_report', {
    p_report_id: reportId, p_reason: reason.trim(),
  })
  if (error) throw reconciliationError(error)
}
