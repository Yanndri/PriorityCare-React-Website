import { supabase } from '../lib/supabaseClient'

// One rescue ticket with the minutes from "opened" to the first time it reached each step
// (null = never reached). From get_response_times (STEP31), scoped to the caller's barangay.
export type TicketTimes = {
  ticket_no: number
  barangay_id: number | null
  barangay_name: string | null
  event_id: string | null
  priority: string
  status: string
  opened_at: string
  to_assigned: number | null
  to_acknowledged: number | null
  to_en_route: number | null
  to_on_scene: number | null
  to_resolved: number | null
}

export async function getResponseTimes(eventId: string | null): Promise<TicketTimes[]> {
  const { data, error } = await supabase.rpc('get_response_times', { p_event: eventId })
  if (error) {
    throw new Error(error.code === 'PGRST202'
      ? 'Response times need STEP31 (get_response_times) to be run in the Supabase SQL Editor.'
      : error.message)
  }
  return (data ?? []) as TicketTimes[]
}
