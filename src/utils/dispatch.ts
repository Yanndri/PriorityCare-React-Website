// Module 5.5 — digital rescue dispatch tickets. Pure helpers (no Supabase) for unit tests.
import type { Resident } from '../types/dashboard'
import { calculateVpi, DEFAULT_VPI_RULES, vpiToday } from './vpi.ts'
import { DEFAULT_EQUIPMENT_RULES, matchEquipment, type EquipmentRule } from './equipmentMatch.ts'

export type TicketStatus = 'open' | 'assigned' | 'acknowledged' | 'en_route' | 'on_scene' | 'resolved' | 'cancelled'
export type TicketPriority = 'critical' | 'high' | 'normal'
export type TicketSource = 'manual' | 'sos' | 'missing_report' | 'triage'

export type DispatchTicket = {
  ticket_id: string
  ticket_no: number
  sitio_id: number
  event_id: string | null
  resident_uid: string | null
  subject: string
  source: TicketSource
  source_ref: string | null
  priority: TicketPriority
  latitude: number | string | null
  longitude: number | string | null
  location_note: string
  instructions: string
  equipment: string[]
  status: TicketStatus
  assigned_unit_id: number | null
  created_at: string
  assigned_at: string | null
  closed_at: string | null
  outcome_note: string | null
  created_by_name: string | null
  last_update: string | null
}

export type RescueUnit = {
  unit_id: number
  unit_name: string
  sitio_id: number | null
  capabilities: string[]
  member_uids: string[]
  is_active: boolean
  editable: boolean
  members: { uid: string; name: string; contact_no: string | null }[]
  live_tickets: number
}

export type IntakeSos = {
  alert_id: string; resident_uid: string; resident_name: string; sitio_id: number
  alert_type: string | null; alert_level: number | null; created_at: string | null
  latitude: number | string | null; longitude: number | string | null
}
export type IntakeMissing = {
  report_id: string; resident_uid: string | null; full_name: string; sitio_id: number
  last_seen_location: string; last_seen_at: string | null; reported_at: string
  latitude: number | string | null; longitude: number | string | null
}

export type DispatchBoard = {
  generated_at: string
  is_super_admin: boolean
  sitios: { sitio_id: number; sitio_name: string }[]
  events: { event_id: string; sitio_id: number; name: string; hazard_type: string }[]
  tickets: DispatchTicket[]
  units: RescueUnit[]
  rescuers: { uid: string; name: string }[]
  intake_sos: IntakeSos[]
  intake_missing: IntakeMissing[]
}

export const STATUS_LABELS: Record<TicketStatus, string> = {
  open: 'Unassigned', assigned: 'Assigned', acknowledged: 'Acknowledged', en_route: 'En route',
  on_scene: 'On scene', resolved: 'Resolved', cancelled: 'Cancelled',
}
export const PRIORITY_LABELS: Record<TicketPriority, string> = { critical: 'Critical', high: 'High', normal: 'Normal' }
export const SOURCE_LABELS: Record<TicketSource, string> = { manual: 'Manual', sos: 'SOS alert', missing_report: 'Missing person', triage: 'Triage pin' }

/** Next forward step for the progress button, or null when only closing remains. */
export function nextStatus(s: TicketStatus): TicketStatus | null {
  return ({ assigned: 'acknowledged', acknowledged: 'en_route', en_route: 'on_scene' } as Partial<Record<TicketStatus, TicketStatus>>)[s] ?? null
}

export type BoardColumn = 'open' | 'assigned' | 'active' | 'closed'
export function columnOf(s: TicketStatus): BoardColumn {
  if (s === 'open') return 'open'
  if (s === 'assigned') return 'assigned'
  if (s === 'resolved' || s === 'cancelled') return 'closed'
  return 'active'
}

export const EQUIPMENT_OPTIONS = ['Stretcher / spineboard', 'Wheelchair', 'Oxygen', 'Boat', 'Life vests', 'First aid kit', 'Infant kit', 'Rope / harness']

/**
 * Suggested priority and equipment for a resident. Priority: SOS level 3, or a High VPI → critical;
 * SOS level 2 or Moderate VPI → high; otherwise normal. Equipment comes from the editable equipment
 * rules (Module 5.4). Suggestions only — the dispatcher decides.
 */
export function suggestForResident(resident: Resident | undefined, sosLevel: number | null = null, asOf = vpiToday(),
  rules: EquipmentRule[] = DEFAULT_EQUIPMENT_RULES) {
  const reasons: string[] = []
  let priority: TicketPriority = 'normal'
  const needs = matchEquipment(resident, rules, asOf)
  if (resident) {
    const v = calculateVpi(resident, DEFAULT_VPI_RULES, asOf)
    if (v.score >= DEFAULT_VPI_RULES.highAt) { priority = 'critical'; reasons.push(`VPI ${v.score} (High)`) }
    else if (v.score >= DEFAULT_VPI_RULES.moderateAt) { priority = 'high'; reasons.push(`VPI ${v.score} (Moderate)`) }
    if (v.level === 'Incomplete') reasons.push('VPI incomplete')
  }
  if (sosLevel !== null && sosLevel >= 3) { priority = 'critical'; reasons.push(`SOS level ${sosLevel}`) }
  else if (sosLevel === 2 && priority === 'normal') { priority = 'high'; reasons.push('SOS level 2') }
  return { priority, equipment: needs.map(n => n.equipment), equipmentReasons: needs, reasons }
}

/** Units sorted for a ticket: active first, those whose capabilities cover the needed equipment first, then least busy. */
export function rankUnits(units: RescueUnit[], equipment: string[]) {
  const norm = (s: string) => s.toLowerCase()
  return units.filter(u => u.is_active).map(u => {
    const caps = u.capabilities.map(norm)
    const covered = equipment.filter(e => caps.some(c => norm(e).includes(c) || c.includes(norm(e).split(' ')[0])))
    return { unit: u, covered: covered.length, missing: equipment.filter(e => !covered.includes(e)) }
  }).sort((a, b) => b.covered - a.covered || a.unit.live_tickets - b.unit.live_tickets || a.unit.unit_name.localeCompare(b.unit.unit_name))
}

export function elapsed(fromIso: string | null, now = Date.now()) {
  if (!fromIso) return ''
  const mins = Math.max(0, Math.round((now - Date.parse(fromIso)) / 60000))
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  return h < 48 ? `${h} h ${mins % 60} min` : `${Math.floor(h / 24)} d`
}

export const ticketLabel = (t: Pick<DispatchTicket, 'ticket_no'>) => `D-${String(t.ticket_no).padStart(4, '0')}`
