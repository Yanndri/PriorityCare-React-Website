import { supabase } from '../lib/supabaseClient'
import type { DispatchBoard, TicketPriority, TicketSource, TicketStatus } from '../utils/dispatch'

function dispatchError(error: { code?: string; message: string }) {
  return new Error(error.code === 'PGRST202'
    ? 'Dispatch tickets need the 20261017_rescue_dispatch_tickets.sql database migration.'
    : error.message)
}
async function call<T>(fn: string, args?: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw dispatchError(error)
  return data as T
}

export const getDispatchBoard = () => call<DispatchBoard>('get_dispatch_board')

export type NewTicket = {
  barangayId: number; eventId: string | null; residentUid: string | null; subject: string
  source: TicketSource; sourceRef: string | null; priority: TicketPriority
  latitude: number | null; longitude: number | null; locationNote: string; instructions: string
  equipment: string[]; unitId: number | null
}
export const createDispatchTicket = (t: NewTicket) => call<string>('create_dispatch_ticket', {
  p_barangay: t.barangayId, p_event_id: t.eventId, p_resident_uid: t.residentUid, p_subject: t.subject.trim(),
  p_source: t.source, p_source_ref: t.sourceRef, p_priority: t.priority, p_lat: t.latitude, p_lng: t.longitude,
  p_location_note: t.locationNote.trim(), p_instructions: t.instructions.trim(), p_equipment: t.equipment, p_unit_id: t.unitId,
})
export const assignDispatchTicket = (ticketId: string, unitId: number, note: string) =>
  call<void>('assign_dispatch_ticket', { p_ticket_id: ticketId, p_unit_id: unitId, p_note: note.trim() })
export const updateDispatchStatus = (ticketId: string, status: TicketStatus, note: string) =>
  call<void>('update_dispatch_status', { p_ticket_id: ticketId, p_status: status, p_note: note.trim() })
export const cancelOpenDispatchTicket = (ticketId: string, note: string) =>
  call<void>('cancel_open_dispatch_ticket', { p_ticket_id: ticketId, p_note: note.trim() })
export const getDispatchTicketHistory = (ticketId: string) =>
  call<{ action: string; from_status: string | null; to_status: string | null; unit_name: string | null; note: string | null; actor_name: string | null; recorded_at: string }[]>(
    'get_dispatch_ticket_history', { p_ticket_id: ticketId })
export const saveRescueUnit = (u: { unitId: number | null; name: string; barangayId: number | null; capabilities: string[]; memberUids: string[]; active: boolean }) =>
  call<number>('save_rescue_unit', { p_unit_id: u.unitId, p_name: u.name.trim(), p_barangay: u.barangayId, p_capabilities: u.capabilities, p_member_uids: u.memberUids, p_active: u.active })

// Backup a responder unit asked for from the app (STEP20). Staff mark it handled here.
export type BackupNeed = 'boat' | 'ambulance' | 'stretcher' | 'road_clearing' | 'more_people' | 'shelter'
export const BACKUP_NEED_LABELS: Record<BackupNeed, string> = {
  boat: 'Rescue boat', ambulance: 'Ambulance', stretcher: 'Stretcher', road_clearing: 'Road clearing', more_people: 'More people',
  shelter: 'An evacuation center (none nearby has room)',
}
export type BackupRequest = {
  request_id: string; ticket_id: string; ticket_no: number; barangay_id: number; need: BackupNeed
  note: string | null; requested_at: string; requested_by_name: string | null; unit_name: string | null
}
export const getBackupRequests = () => call<BackupRequest[]>('get_backup_requests')
export const closeBackupRequest = (requestId: string, action: 'handled' | 'cancel') =>
  call<void>('close_backup_request', { p_request_id: requestId, p_action: action })

// Residents whose account is not verified yet (STEP26 trust level): their SOS still goes through,
// but staff see that the household details are self-reported.
// The resident's own SOS note ("water is waist deep, Lola can't walk"), by SOS id, for tickets made from an SOS.
export async function getSosNotes(alertIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(alertIds.filter(Boolean))]
  if (!ids.length) return new Map()
  const { data, error } = await supabase.from('sos_alerts').select('alert_id, note').in('alert_id', ids)
  if (error) return new Map()
  return new Map((data ?? []).filter((a) => a.note && String(a.note).trim()).map((a) => [String(a.alert_id), String(a.note).trim()]))
}

// Which household members the resident ticked as "with me" on this SOS (STEP30).
// null = not given (older SOS, or STEP30 not applied): treat it as the whole household.
export async function getSosWithMembers(alertId: string): Promise<string[] | null> {
  const { data, error } = await supabase.from('sos_alerts').select('members_listed, sos_alert_members(member_id)')
    .eq('alert_id', alertId).maybeSingle()
  if (error || !data?.members_listed) return null
  return ((data.sos_alert_members ?? []) as { member_id: string }[]).map((m) => String(m.member_id))
}

export async function getUnverifiedResidents(uids: string[]): Promise<Set<string>> {
  const ids = [...new Set(uids.filter(Boolean))]
  if (!ids.length) return new Set()
  const { data, error } = await supabase.from('users').select('uid, is_verified').in('uid', ids)
  if (error) return new Set()
  return new Set((data ?? []).filter((u) => !u.is_verified).map((u) => String(u.uid)))
}
