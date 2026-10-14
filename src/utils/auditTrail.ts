// Operational timestamp log / evacuation audit trail: filtering and table/CSV shaping.
// Pure functions (no Supabase, no export libraries) so they can be unit-tested.

export type TimelineCategory =
  | 'evacuation' | 'evacuation_change' | 'facility' | 'disaster_event' | 'missing_person' | 'verification' | 'sos'

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

export function timelineRows(events: TimelineEvent[], sitioName: (id: number) => string): string[][] {
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
    ...timelineRows(events, sitioName),
  ]
  return '﻿' + lines.map(l => l.map(csvCell).join(',')).join('\r\n')
}

export function timelineFileName(from: string, to: string, ext: string) {
  return `prioritycare-audit-log_${formatPht(from).slice(0, 10)}_to_${formatPht(new Date(Date.parse(to) - 1).toISOString()).slice(0, 10)}.${ext}`
}
