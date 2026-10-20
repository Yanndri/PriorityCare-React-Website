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
