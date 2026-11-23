// Reconciles the Missing Persons Manifest against the Master Rescued Directory.
// Pure functions only (no Supabase access) so they can be unit-tested.

export type EvacStatus = 'pending' | 'in_transit' | 'safely_evacuated' | 'failed' | 'returned_home'
export type ReportStatus = 'missing' | 'found' | 'withdrawn'

export type RegistryResident = {
  uid: string
  barangay_id: number
  f_name: string | null
  m_name: string | null
  l_name: string | null
  sex: string | null
  birthdate: string | null
  latest_status: EvacStatus | null
  latest_logged_at: string | null
  evacuated_at: string | null
  center_id: number | null
  center_name: string | null
  /** Who this is: an account holder (default), a household member, or a walk-in checked in by a responder. */
  kind?: 'resident' | 'member' | 'walkin'
  /** Check-in record (members and walk-ins only), used to close a report against it. */
  record_id?: string
  member_id?: string | null
}

/** A household member or walk-in who is safe at a center (STEP36). */
export type CenterCheckIn = {
  kind: 'member' | 'walkin'
  record_id: string
  member_id: string | null
  name: string
  sex: string | null
  birthdate: string | null
  barangay_id: number | null
  evacuated_at: string | null
  logged_at: string | null
  center_id: number | null
  center_name: string | null
}

export type MissingPersonReport = {
  report_id: string
  barangay_id: number
  event_id: string | null
  resident_uid: string | null
  /** Set when the household flagged this member missing from the resident app. */
  member_id?: string | null
  full_name: string
  sex: 'male' | 'female' | null
  approx_age: number | null
  last_seen_location: string
  last_seen_at: string | null
  reporter_name: string
  reporter_contact: string
  notes: string
  status: ReportStatus
  matched_resident_uid: string | null
  reconciled_at: string | null
  reconciliation_note: string | null
  reported_at: string
}

export type ReconciliationEvent = {
  event_id: string
  barangay_id: number
  name: string
  hazard_type: string
  status: 'active' | 'resolved'
  started_at: string
}

export type ReconciliationData = {
  generated_at: string
  barangays: { barangay_id: number; barangay_name: string }[]
  events: ReconciliationEvent[]
  reports: MissingPersonReport[]
  residents: RegistryResident[]
  /** Household members and walk-ins safe at a center. Missing until STEP36 is run. */
  checkins?: CenterCheckIn[]
}

export type MatchCandidate = {
  resident: RegistryResident
  /** true when sex and age were both given and both agree; false when one of them was not given */
  full: boolean
  /** true when the report names this exact person record (no name guessing). */
  exact?: boolean
  reasons: string[]
}

export type MatchClass =
  | 'linked-rescued'   // report is linked to a registered resident who is in the rescued directory
  | 'probable'         // a rescued resident passes all four checks (last name, first name, sex, age)
  | 'possible'         // name checks pass, but the report left out the sex or the age
  | 'no-match'         // nobody in the rescued directory resembles the report

export type ReconciledReport = {
  report: MissingPersonReport
  classification: MatchClass
  candidates: MatchCandidate[]
  linkedResident: RegistryResident | null
}

export type ReconciliationResult = {
  rescued: RegistryResident[]
  open: ReconciledReport[]
  closed: MissingPersonReport[]
  summary: {
    rescued: number
    openReports: number
    linkedRescued: number
    probable: number
    possible: number
    noMatch: number
    found: number
    withdrawn: number
  }
}

const MAX_CANDIDATES = 3

export function fullName(r: Pick<RegistryResident, 'f_name' | 'm_name' | 'l_name'>) {
  return [r.f_name, r.m_name, r.l_name].filter(p => p && p.trim()).map(p => p!.trim()).join(' ')
}

export function normalizeName(name: string) {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Jaro-Winkler similarity in [0, 1]. */
export function jaroWinkler(a: string, b: string) {
  if (a === b) return a.length ? 1 : 0
  if (!a.length || !b.length) return 0
  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1)
  const aHit = new Array<boolean>(a.length).fill(false)
  const bHit = new Array<boolean>(b.length).fill(false)
  let matches = 0
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - window); j < Math.min(b.length, i + window + 1); j++) {
      if (!bHit[j] && a[i] === b[j]) { aHit[i] = bHit[j] = true; matches++; break }
    }
  }
  if (!matches) return 0
  let t = 0
  for (let i = 0, k = 0; i < a.length; i++) {
    if (!aHit[i]) continue
    while (!bHit[k]) k++
    if (a[i] !== b[k]) t++
    k++
  }
  const jaro = (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3
  let prefix = 0
  while (prefix < 4 && a[prefix] === b[prefix]) prefix++
  return jaro + prefix * 0.1 * (1 - jaro)
}

export function ageOn(birthdate: string | null, asOf: Date) {
  if (!birthdate || !/^\d{4}-\d{2}-\d{2}/.test(birthdate)) return null
  const [y, m, d] = birthdate.slice(0, 10).split('-').map(Number)
  const ref = new Date(asOf.getTime() + 8 * 3600000) // Philippine calendar date
  let age = ref.getUTCFullYear() - y
  if (ref.getUTCMonth() + 1 < m || (ref.getUTCMonth() + 1 === m && ref.getUTCDate() < d)) age--
  return age >= 0 && age <= 130 ? age : null
}

// The matching rule, in plain words. A rescued resident is a match for a report when:
//   1. the last name is the same (ignoring capitals and accents),
//   2. the first name is the same or nearly the same (a small typo such as "Jon" for "John"),
//   3. the sex is the same (skipped if the report left it out),
//   4. the age is within 5 years (skipped if the report left it out).
// The admin still confirms every match. Nothing is closed automatically.
export const MAX_AGE_GAP = 5
const FIRST_NAME_SIMILAR = 0.85 // Jaro-Winkler similarity, a standard measure for comparing names

const words = (name: string | null) => normalizeName(name ?? '').split(' ').filter(Boolean)

export function checkCandidate(report: MissingPersonReport, resident: RegistryResident, asOf: Date): MatchCandidate | null {
  const kind = resident.kind ?? 'resident'
  // A report about a known person: only that person's own record is an exact match.
  // A walk-in can still be them, so walk-ins go through the name checks below.
  if (report.member_id && kind !== 'walkin') {
    return kind === 'member' && resident.member_id === report.member_id
      ? { resident, full: true, exact: true, reasons: [`Same household member, checked in at ${resident.center_name ?? 'a center'}`] }
      : null
  }
  if (report.resident_uid && kind !== 'walkin') {
    return report.resident_uid === resident.uid
      ? { resident, full: true, exact: true, reasons: ['The report names this registered resident'] }
      : null
  }
  const reported = words(report.full_name)
  if (reported.length < 2) return null // a first name alone is not enough to suggest anyone
  const reportedLast = reported[reported.length - 1]
  const reportedFirst = reported[0]
  const last = words(resident.l_name)
  const first = words(resident.f_name)
  if (!last.length || !first.length) return null

  // 1. Same last name.
  if (last.join(' ') !== reportedLast && last[last.length - 1] !== reportedLast) return null
  const reasons = ['Same last name']

  // 2. Same or nearly the same first name.
  const firstSame = first.includes(reportedFirst)
  if (!firstSame && Math.max(...first.map(f => jaroWinkler(f, reportedFirst))) < FIRST_NAME_SIMILAR) return null
  reasons.push(firstSame ? 'Same first name' : `First name nearly the same (${resident.f_name} / ${reported[0]})`)

  // 3. Same sex.
  let full = true
  if (report.sex && resident.sex) {
    if (report.sex !== resident.sex) return null
    reasons.push('Same sex')
  } else full = false

  // 4. Age within 5 years.
  const age = ageOn(resident.birthdate, asOf)
  if (report.approx_age !== null && age !== null) {
    if (Math.abs(report.approx_age - age) > MAX_AGE_GAP) return null
    reasons.push(`Age ${age}, reported about ${report.approx_age}`)
  } else full = false

  if (!full) reasons.push('Sex or age not given, check carefully')
  return { resident, full, reasons }
}

export const isRescued = (r: RegistryResident) => r.latest_status === 'safely_evacuated'

/** Turns a center check-in into the same shape as a registered resident, so one list holds everyone who is safe. */
export function checkInAsResident(c: CenterCheckIn, fallbackBarangay: number): RegistryResident {
  const parts = c.name.trim().split(/\s+/)
  const last = parts.length > 1 ? parts.pop()! : null
  return {
    uid: `rec:${c.record_id}`, barangay_id: c.barangay_id ?? fallbackBarangay,
    f_name: parts.join(' '), m_name: null, l_name: last,
    sex: c.sex, birthdate: c.birthdate,
    latest_status: 'safely_evacuated', latest_logged_at: c.logged_at, evacuated_at: c.evacuated_at,
    center_id: c.center_id, center_name: c.center_name,
    kind: c.kind, record_id: c.record_id, member_id: c.member_id,
  }
}

export function reconcile(data: ReconciliationData, asOf = new Date()): ReconciliationResult {
  const rescued = [...data.residents.filter(isRescued),
    ...(data.checkins ?? []).map(c => checkInAsResident(c, data.barangays[0]?.barangay_id ?? 0))]
  const byUid = new Map(data.residents.map(r => [r.uid, r]))
  const openReports = data.reports.filter(r => r.status === 'missing')

  const open: ReconciledReport[] = openReports.map(report => {
    const linkedResident = report.resident_uid ? byUid.get(report.resident_uid) ?? null : null
    const candidates = rescued
      .map(r => checkCandidate(report, r, asOf))
      .filter((c): c is MatchCandidate => c !== null)
      .sort((a, b) => Number(b.full) - Number(a.full) || fullName(a.resident).localeCompare(fullName(b.resident)))
      .slice(0, MAX_CANDIDATES)
    const classification: MatchClass =
      (linkedResident && isRescued(linkedResident)) || candidates[0]?.exact ? 'linked-rescued'
        : candidates[0]?.full ? 'probable'
          : candidates.length ? 'possible' : 'no-match'
    return { report, classification, candidates, linkedResident }
  })
  const order: Record<MatchClass, number> = { 'linked-rescued': 0, probable: 1, possible: 2, 'no-match': 3 }
  open.sort((a, b) => order[a.classification] - order[b.classification]
    || a.report.reported_at.localeCompare(b.report.reported_at))

  const closed = data.reports.filter(r => r.status !== 'missing')
  const count = (c: MatchClass) => open.filter(o => o.classification === c).length
  return {
    rescued, open, closed,
    summary: {
      rescued: rescued.length,
      openReports: open.length,
      linkedRescued: count('linked-rescued'),
      probable: count('probable'),
      possible: count('possible'),
      noMatch: count('no-match'),
      found: closed.filter(r => r.status === 'found').length,
      withdrawn: closed.filter(r => r.status === 'withdrawn').length,
    },
  }
}

export const matchLabels: Record<MatchClass, string> = {
  'linked-rescued': 'Checked in at a center',
  probable: 'Likely match',
  possible: 'Partial match',
  'no-match': 'Still missing',
}

export const statusLabels: Record<EvacStatus, string> = {
  pending: 'Pending', in_transit: 'In transit', safely_evacuated: 'Safely evacuated', failed: 'Failed / not reached', returned_home: 'Went home',
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? '' : String(value)
  // Neutralise spreadsheet formula injection, then quote.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return `"${safe.replace(/"/g, '""')}"`
}

export function reconciliationCsv(result: ReconciliationResult, barangayName: (id: number) => string) {
  const header = ['Section', 'Report ID', 'Name', 'Barangay', 'Sex', 'Age', 'Reconciliation', 'Best match', 'Why it matches',
    'Evacuation center', 'Last seen', 'Reporter', 'Reported at', 'Note']
  const rows: unknown[][] = []
  for (const o of result.open) {
    const best = o.linkedResident && o.classification === 'linked-rescued'
      ? { resident: o.linkedResident, reasons: ['The report names this registered resident'] } : o.candidates[0]
    rows.push(['Open manifest', o.report.report_id, o.report.full_name, barangayName(o.report.barangay_id), o.report.sex ?? '',
      o.report.approx_age ?? '', matchLabels[o.classification], best ? fullName(best.resident) : '', best?.reasons.join('; ') ?? '',
      best?.resident.center_name ?? '', o.report.last_seen_location, o.report.reporter_name, o.report.reported_at, o.report.notes])
  }
  for (const r of result.closed) {
    rows.push(['Closed report', r.report_id, r.full_name, barangayName(r.barangay_id), r.sex ?? '', r.approx_age ?? '',
      r.status === 'found' ? 'Found' : 'Withdrawn', '', '', '', r.last_seen_location, r.reporter_name, r.reported_at,
      r.reconciliation_note ?? ''])
  }
  for (const r of result.rescued) {
    rows.push(['Master rescued directory', '', fullName(r), barangayName(r.barangay_id), r.sex ?? '', '',
      'Safely evacuated', '', '', r.center_name ?? '', '', '', r.evacuated_at ?? r.latest_logged_at ?? '', ''])
  }
  return '﻿' + [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n')
}
