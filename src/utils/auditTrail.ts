// Operational timestamp log / evacuation audit trail: filtering, table and CSV shaping.
// Pure functions (no Supabase, no export libraries) so they can be unit-tested.
// Shapes match the get_operational_timeline() RPC. Used by Reports (components/AuditTrailPanel)
// and Data Mining (components/analytics/AuditTrailPanel).

export type TimelineEvent = {
  occurred_at: string
  category: TimelineCategory
  action: string
  subject: string | null
  sitio_id: number | null
  from_value: string | null
  to_value: string | null
  actor_name: string | null
  actor_role: string | null
  details: string | null
  ref_id: string | null
}

export type TimelineData = {
  generated_at: string
  from: string
  to: string
  scope: string
  sitios: { sitio_id: number; sitio_name: string }[]
  events: TimelineEvent[]
}

export const timelineCategories = {
  evacuation: 'Evacuation status logs',
  evacuation_change: 'Evacuation record edits / deletions',
  facility: 'Evacuation center status & capacity',
  disaster_event: 'Disaster event declarations',
  missing_person: 'Missing-person manifest actions',
  verification: 'Resident verification',
  sos: 'SOS alerts raised',
} as const
export type TimelineCategory = keyof typeof timelineCategories

// What each source records — shown with results so an empty category is not
// mistaken for a complete log of inactivity.
export const categoryCoverage: Record<TimelineCategory, string> = {
  evacuation: 'One entry per evacuation record at its logged time (evacuated time if not logged). "From" is the resident’s previous record status.',
  evacuation_change: 'Edits and deletions captured by the evacuation audit trigger. Changes made before the trigger existed are not in the log.',
  facility: 'Facility-wide center status and capacity changes (shared across sitios).',
  disaster_event: 'Declarations and resolutions with actor and reason.',
  missing_person: 'Reports filed, marked found, or withdrawn.',
  verification: 'Document uploads and review decisions.',
  sos: 'Creation time only. SOS status changes are not timestamped in the database.',
}

export const MAX_RANGE_DAYS = 366

// Converts inclusive Asia/Manila calendar dates into a UTC [start, end) range.
export function manilaDateRange(fromDate: string, toDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
    throw new Error('Choose both a start date and an end date.')
  }
  const start = Date.parse(`${fromDate}T00:00:00+08:00`)
  const end = Date.parse(`${toDate}T00:00:00+08:00`) + 86_400_000
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) throw new Error('The start date must be on or before the end date.')
  if (end - start > MAX_RANGE_DAYS * 86_400_000) throw new Error(`Choose a range of at most ${MAX_RANGE_DAYS} days.`)
  return { from: new Date(start).toISOString(), to: new Date(end).toISOString() }
}

export function manilaDate(offsetDays = 0, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(now.getTime() + offsetDays * 86_400_000))
}

export function manilaTimestamp(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Invalid timestamp'
  // Seconds are kept so ordering and exported times stay exact.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(date).replace(',', '') + ' PHT'
}

export function countByCategory(events: TimelineEvent[]) {
  const counts = Object.fromEntries(Object.keys(timelineCategories).map((key) => [key, 0])) as Record<TimelineCategory, number>
  for (const event of events) if (event.category in counts) counts[event.category]++
  return counts
}

export const timelineHeaders = ['Occurred (UTC, ISO 8601)', 'Occurred (Asia/Manila)', 'Category', 'Action', 'Subject', 'Sitio', 'From', 'To', 'Actor', 'Actor role', 'Details', 'Reference ID']

export function timelineRows(data: TimelineData, events: TimelineEvent[]) {
  const sitioName = new Map(data.sitios.map((sitio) => [sitio.sitio_id, sitio.sitio_name]))
  return events.map((event) => [
    new Date(event.occurred_at).toISOString(),
    manilaTimestamp(event.occurred_at),
    timelineCategories[event.category] ?? event.category,
    event.action,
    event.subject ?? '',
    event.sitio_id === null ? 'All sitios (facility-wide)' : sitioName.get(event.sitio_id) ?? `Sitio ${event.sitio_id}`,
    event.from_value ?? '',
    event.to_value ?? '',
    event.actor_name ?? 'Not recorded',
    event.actor_role ?? '',
    event.details ?? '',
    event.ref_id ?? '',
  ])
}

// RFC 4180 CSV with spreadsheet-formula neutralisation for text cells.
export function toCsv(headers: string[], rows: (string | number | null)[][]) {
  const cell = (value: string | number | null) => {
    if (value === null) return ''
    if (typeof value === 'number') return String(value)
    const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  return [headers, ...rows].map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n'
}

export const CATEGORY_LABELS: Record<TimelineCategory, string> = {
  evacuation: 'Evacuation status',
  evacuation_change: 'Evacuation record edit/delete',
  facility: 'Evacuation center',
  disaster_event: 'Disaster event',
  missing_person: 'Missing person',
  verification: 'Verification',
  sos: 'SOS alert',
}
export const ALL_CATEGORIES = Object.keys(CATEGORY_LABELS) as TimelineCategory[]

const VALUE_LABELS: Record<string, string> = {
  pending: 'Pending', in_transit: 'In transit', safely_evacuated: 'Safely evacuated', failed: 'Failed / not reached',
  active: 'Active', closed: 'Closed', resolved: 'Resolved', missing: 'Missing', found: 'Found', withdrawn: 'Withdrawn',
  approved: 'Approved', rejected: 'Rejected',
}
export const valueLabel = (v: string | null) => v === null || v === '' ? '' : VALUE_LABELS[v] ?? v

export type TimelineFilter = {
  categories: TimelineCategory[]
  /** null = every sitio in scope; 0 = facility-wide events with no sitio. */
  sitioId: number | null
  search: string
}

export function filterTimeline(events: TimelineEvent[], filter: TimelineFilter) {
  const cats = new Set(filter.categories)
  const q = filter.search.trim().toLowerCase()
  return events.filter(e => cats.has(e.category)
    && (filter.sitioId === null || (filter.sitioId === 0 ? e.sitio_id === null : e.sitio_id === filter.sitioId))
    && (!q || [e.action, e.subject, e.actor_name, e.details, e.from_value, e.to_value, e.ref_id]
      .some(v => v && v.toLowerCase().includes(q))))
}

/** "2026-10-14 08:05:09" in Asia/Manila. */
export function formatPht(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map(x => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`
}

/** Converts a Philippine-time "YYYY-MM-DD" date to the UTC instant of its midnight. */
export function phtDayStart(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid date.')
  const t = new Date(`${date}T00:00:00+08:00`)
  if (Number.isNaN(t.getTime())) throw new Error('Invalid date.')
  return t
}

export const TIMELINE_HEADERS = ['Time (PHT)', 'Category', 'Action', 'Subject', 'Sitio', 'From', 'To', 'By', 'Role', 'Details', 'Reference']

/** Reports-panel table rows (PHT time first). The Data Mining panel uses timelineRows(data, events). */
export function timelineTableRows(events: TimelineEvent[], sitioName: (id: number) => string): string[][] {
  return events.map(e => [
    formatPht(e.occurred_at), CATEGORY_LABELS[e.category] ?? e.category, e.action, e.subject ?? '',
    e.sitio_id === null ? 'All (facility-wide)' : sitioName(e.sitio_id),
    valueLabel(e.from_value), valueLabel(e.to_value), e.actor_name ?? 'Not recorded', e.actor_role ?? '',
    e.details ?? '', e.ref_id ?? '',
  ])
}

export function categoryCounts(events: TimelineEvent[]) {
  return ALL_CATEGORIES.map(c => [CATEGORY_LABELS[c], events.filter(e => e.category === c).length] as const)
}

function csvCell(value: string) {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value // spreadsheet formula-injection guard
  return `"${safe.replace(/"/g, '""')}"`
}

export function timelineCsv(events: TimelineEvent[], sitioName: (id: number) => string, meta: { scope: string; from: string; to: string; generatedAt: string }) {
  const lines = [
    ['PriorityCare operational timestamp log'],
    ['Scope', meta.scope],
    ['From (PHT)', formatPht(meta.from)],
    ['To (PHT, exclusive)', formatPht(meta.to)],
    ['Generated (PHT)', formatPht(meta.generatedAt)],
    [],
    TIMELINE_HEADERS,
    ...timelineTableRows(events, sitioName),
  ]
  return '﻿' + lines.map(l => l.map(csvCell).join(',')).join('\r\n')
}

export function timelineFileName(from: string, to: string, ext: string) {
  return `prioritycare-audit-log_${formatPht(from).slice(0, 10)}_to_${formatPht(new Date(Date.parse(to) - 1).toISOString()).slice(0, 10)}.${ext}`
}
