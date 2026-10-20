import { supabase } from '../lib/supabaseClient'

// Module: Log Resident Pre-emptive Evacuation Status & Intended Destination.
// Database: supabase/migrations/20261020_01_preemptive_evacuation.sql

export const preemptiveStatusLabels = {
  staying_home: 'Staying home',
  preparing: 'Preparing to leave',
  evacuating: 'On the way',
  arrived: 'Arrived at destination',
  returned_home: 'Returned home',
} as const
export type PreemptiveStatus = keyof typeof preemptiveStatusLabels

export const destinationTypeLabels = {
  evacuation_center: 'Evacuation center',
  relative_friend: "Relative's or friend's house",
  other: 'Other safe place',
} as const
export type DestinationType = keyof typeof destinationTypeLabels

// Statuses that have a destination.
export const statusNeedsDestination = (status: PreemptiveStatus) =>
  status === 'preparing' || status === 'evacuating' || status === 'arrived'

export type PreemptiveLog = {
  log_id: string
  status: PreemptiveStatus
  destination_type: DestinationType | null
  destination_center_id: number | null
  destination_center_name: string | null
  destination_address: string
  headcount: number
  note: string
  event_id: string | null
  event_name: string | null
  source: 'resident' | 'staff' | 'rescuer'
  reported_by_name: string | null
  logged_at: string
}

export type PreemptiveResident = {
  uid: string
  name: string
  barangay_id: number
  barangay_name: string
  sitio: string
  mobility: string
  household_name: string | null
  household_size: number
  latest: PreemptiveLog | null
}

export type PreemptiveBoard = {
  barangays: { barangay_id: number; barangay_name: string }[]
  events: { event_id: string; barangay_id: number; name: string; hazard_type: string }[]
  centers: { center_id: number; center_name: string; barangay_id: number | null }[]
  residents: PreemptiveResident[]
}

export type PreemptiveLogInput = {
  residentUid: string
  eventId: string | null
  status: PreemptiveStatus
  destinationType: DestinationType | null
  centerId: number | null
  destinationAddress: string
  headcount: number | null
  note: string
}

function preemptiveError(error: { code?: string; message: string }) {
  return new Error(error.code === 'PGRST202'
    ? 'Pre-emptive evacuation logging needs the 20261020_01_preemptive_evacuation.sql database migration.'
    : error.message)
}

// barangayId null = every barangay (super admin only; admins always get their own).
export async function getPreemptiveBoard(barangayId: number | null): Promise<PreemptiveBoard> {
  const { data, error } = await supabase.rpc('get_preemptive_evacuation_board', { p_barangay: barangayId })
  if (error) throw preemptiveError(error)
  return data as PreemptiveBoard
}

export async function getPreemptiveHistory(residentUid: string): Promise<PreemptiveLog[]> {
  const { data, error } = await supabase.rpc('get_preemptive_evacuation_history', { p_resident_uid: residentUid })
  if (error) throw preemptiveError(error)
  return (data ?? []) as PreemptiveLog[]
}

export async function logPreemptiveEvacuation(input: PreemptiveLogInput) {
  const withDestination = statusNeedsDestination(input.status)
  const { error } = await supabase.rpc('log_preemptive_evacuation', {
    p_resident_uid: input.residentUid,
    p_event_id: input.eventId,
    p_status: input.status,
    p_destination_type: withDestination ? input.destinationType : null,
    p_center_id: withDestination && input.destinationType === 'evacuation_center' ? input.centerId : null,
    p_destination_address: withDestination && input.destinationType !== 'evacuation_center' ? input.destinationAddress.trim() : '',
    p_headcount: input.headcount,
    p_note: input.note.trim(),
  })
  if (error) throw preemptiveError(error)
}

// "Gabi Evacuation Center", "Tita's house, Pilipog", or "" when there is no destination.
export function destinationLabel(log: Pick<PreemptiveLog, 'destination_type' | 'destination_center_name' | 'destination_address'>) {
  if (!log.destination_type) return ''
  if (log.destination_type === 'evacuation_center') return log.destination_center_name ?? 'Evacuation center (removed)'
  return log.destination_address
}
