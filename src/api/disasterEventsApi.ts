import { supabase } from '../lib/supabaseClient'

export const hazardLabels = { flood: 'Flood', fire: 'Fire', earthquake: 'Earthquake', landslide: 'Landslide' } as const
export type HazardType = keyof typeof hazardLabels
export type DisasterEvent = {
  event_id: string; sitio_id: number; name: string; hazard_type: HazardType
  location_description: string; latitude: number | null; longitude: number | null
  started_at: string; notes: string; status: 'active' | 'resolved'
  declared_at: string; declared_by: string; resolved_at: string | null
  resolved_by: string | null; resolution_reason: string | null
}
export type EventRegister = {
  sitios: { sitio_id: number; sitio_name: string }[]
  events: DisasterEvent[]
}
export type DeclarationInput = {
  sitio: number; name: string; hazard: HazardType; location: string
  startedAt: string; notes: string; latitude: number | null; longitude: number | null
}
function eventError(error: { code?: string; message: string }) {
  return new Error(error.code === 'PGRST202'
    ? 'Disaster declarations need the 20261014_disaster_events.sql database migration.' : error.message)
}
export async function getEventRegister(): Promise<EventRegister> {
  const { data, error } = await supabase.rpc('get_disaster_event_register')
  if (error) throw eventError(error)
  return data as EventRegister
}
export async function declareEvent(input: DeclarationInput) {
  const { data, error } = await supabase.rpc('declare_disaster_event', {
    p_sitio: input.sitio, p_name: input.name.trim(), p_hazard: input.hazard,
    p_location: input.location.trim(), p_started_at: input.startedAt, p_notes: input.notes.trim(),
    p_lat: input.latitude, p_long: input.longitude,
  })
  if (error) throw eventError(error)
  return data as string
}
export async function resolveEvent(id: string, reason: string) {
  const { error } = await supabase.rpc('resolve_disaster_event', { p_event_id: id, p_reason: reason.trim() })
  if (error) throw eventError(error)
}
