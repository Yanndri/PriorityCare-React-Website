// Reconciles the Missing Persons Manifest against the Master Rescued Directory.
// Pure functions only (no Supabase access) so they can be unit-tested.

export type EvacStatus = 'pending' | 'in_transit' | 'safely_evacuated' | 'failed'
export type ReportStatus = 'missing' | 'found' | 'withdrawn'

export type RegistryResident = {
  uid: string
  sitio_id: number
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
}

export type MissingPersonReport = {
  report_id: string
  sitio_id: number
  event_id: string | null
  resident_uid: string | null
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
  sitio_id: number
  name: string
  hazard_type: string
  status: 'active' | 'resolved'
  started_at: string
}

export type ReconciliationData = {
  generated_at: string
  sitios: { sitio_id: number; sitio_name: string }[]
  events: ReconciliationEvent[]
  reports: MissingPersonReport[]
  residents: RegistryResident[]
}

export type MatchCandidate = {
  resident: RegistryResident
  score: number
  reasons: string[]
}

export type MatchClass =
  | 'linked-rescued'   // report is linked to a registered resident who is in the rescued directory
  | 'probable'         // best name/sex/age match scores >= PROBABLE_SCORE
  | 'possible'         // best match scores >= POSSIBLE_SCORE
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
  unaccounted: RegistryResident[]
  summary: {
    rescued: number
    openReports: number
    linkedRescued: number
    probable: number
    possible: number
    noMatch: number
    found: number
    withdrawn: number
    unaccounted: number
  }
}

export const PROBABLE_SCORE = 85
export const POSSIBLE_SCORE = 60
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

/**
 * Name similarity tolerant of word order, middle names and small typos.
 * Each token of the shorter name is paired with its best token in the other name.
 */
export function nameSimilarity(a: string, b: string) {
  const ta = normalizeName(a).split(' ').filter(Boolean)
  const tb = normalizeName(b).split(' ').filter(Boolean)
  if (!ta.length || !tb.length) return 0
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta]
  const tokenScore = short.reduce((sum, s) => sum + Math.max(...long.map(l =>
    // Initials ("J." vs "Juan") count as a partial match.
    s.length === 1 || l.length === 1 ? (s[0] === l[0] ? 0.8 : 0) : jaroWinkler(s, l))), 0) / short.length
  const whole = jaroWinkler([...ta].sort().join(' '), [...tb].sort().join(' '))
  // A single-word report ("Juan") should not look as strong as a full-name match.
  const coverage = short.length === 1 && long.length > 1 ? 0.85 : 1
  return Math.max(tokenScore, whole) * coverage
}

export function ageOn(birthdate: string | null, asOf: Date) {
  if (!birthdate || !/^\d{4}-\d{2}-\d{2}/.test(birthdate)) return null
  const [y, m, d] = birthdate.slice(0, 10).split('-').map(Number)
  const ref = new Date(asOf.getTime() + 8 * 3600000) // Philippine calendar date
  let age = ref.getUTCFullYear() - y
  if (ref.getUTCMonth() + 1 < m || (ref.getUTCMonth() + 1 === m && ref.getUTCDate() < d)) age--
  return age >= 0 && age <= 130 ? age : null
}

export function scoreCandidate(report: MissingPersonReport, resident: RegistryResident, asOf: Date): MatchCandidate | null {
  if (report.resident_uid) {
    return report.resident_uid === resident.uid
      ? { resident, score: 100, reasons: ['Report is linked to this registered resident'] }
      : null
  }
  const similarity = nameSimilarity(report.full_name, fullName(resident))
  if (similarity < 0.75) return null
  const reasons = [`Name ${Math.round(similarity * 100)}% similar`]
  let score = similarity * 70
  if (report.sex && resident.sex) {
    if (report.sex !== resident.sex) return null
    score += 10; reasons.push('Same sex')
  }
  const age = ageOn(resident.birthdate, asOf)
  if (report.approx_age !== null && age !== null) {
    const diff = Math.abs(report.approx_age - age)
    if (diff > 10) return null
    if (diff <= 2) { score += 20; reasons.push(`Age ${age} (reported ~${report.approx_age})`) }
    else if (diff <= 5) { score += 10; reasons.push(`Age ${age} (reported ~${report.approx_age})`) }
    else { score -= 10; reasons.push(`Age ${age} differs from reported ~${report.approx_age}`) }
  }
  if (report.sitio_id === resident.sitio_id) reasons.push('Same sitio')
  return { resident, score: Math.max(0, Math.min(99, Math.round(score))), reasons }
}

export const isRescued = (r: RegistryResident) => r.latest_status === 'safely_evacuated'

export function reconcile(data: ReconciliationData, asOf = new Date()): ReconciliationResult {
  const rescued = data.residents.filter(isRescued)
  const byUid = new Map(data.residents.map(r => [r.uid, r]))
  const openReports = data.reports.filter(r => r.status === 'missing')

  const open: ReconciledReport[] = openReports.map(report => {
    const linkedResident = report.resident_uid ? byUid.get(report.resident_uid) ?? null : null
    const candidates = rescued
      .map(r => scoreCandidate(report, r, asOf))
      .filter((c): c is MatchCandidate => c !== null && c.score >= POSSIBLE_SCORE)
      .sort((a, b) => b.score - a.score || fullName(a.resident).localeCompare(fullName(b.resident)))
      .slice(0, MAX_CANDIDATES)
    const best = candidates[0]?.score ?? 0
    const classification: MatchClass =
      linkedResident && isRescued(linkedResident) ? 'linked-rescued'
        : best >= PROBABLE_SCORE ? 'probable'
          : best >= POSSIBLE_SCORE ? 'possible' : 'no-match'
    return { report, classification, candidates, linkedResident }
  })
  const order: Record<MatchClass, number> = { 'linked-rescued': 0, probable: 1, possible: 2, 'no-match': 3 }
  open.sort((a, b) => order[a.classification] - order[b.classification]
    || a.report.reported_at.localeCompare(b.report.reported_at))

  // Registered residents in sitios with an active disaster event who are neither
  // confirmed rescued nor already on the open manifest.
  const activeSitios = new Set(data.events.filter(e => e.status === 'active').map(e => e.sitio_id))
  const onManifest = new Set(openReports.map(r => r.resident_uid).filter(Boolean))
  const unaccounted = data.residents.filter(r =>
    activeSitios.has(r.sitio_id) && !isRescued(r) && !onManifest.has(r.uid))

  const closed = data.reports.filter(r => r.status !== 'missing')
  const count = (c: MatchClass) => open.filter(o => o.classification === c).length
  return {
    rescued, open, closed, unaccounted,
    summary: {
      rescued: rescued.length,
      openReports: open.length,
      linkedRescued: count('linked-rescued'),
      probable: count('probable'),
      possible: count('possible'),
      noMatch: count('no-match'),
      found: closed.filter(r => r.status === 'found').length,
      withdrawn: closed.filter(r => r.status === 'withdrawn').length,
      unaccounted: unaccounted.length,
    },
  }
}

export const matchLabels: Record<MatchClass, string> = {
  'linked-rescued': 'Confirmed in rescued directory',
  probable: 'Probable match',
  possible: 'Possible match',
  'no-match': 'Still missing',
}

export const statusLabels: Record<EvacStatus, string> = {
  pending: 'Pending', in_transit: 'In transit', safely_evacuated: 'Safely evacuated', failed: 'Failed / not reached',
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? '' : String(value)
  // Neutralise spreadsheet formula injection, then quote.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return `"${safe.replace(/"/g, '""')}"`
}

export function reconciliationCsv(result: ReconciliationResult, sitioName: (id: number) => string) {
  const header = ['Section', 'Report ID', 'Name', 'Sitio', 'Sex', 'Age', 'Reconciliation', 'Best match', 'Match score',
    'Evacuation center', 'Last seen', 'Reporter', 'Reported at', 'Note']
  const rows: unknown[][] = []
  for (const o of result.open) {
    const best = o.linkedResident && o.classification === 'linked-rescued'
      ? { resident: o.linkedResident, score: 100 } : o.candidates[0]
    rows.push(['Open manifest', o.report.report_id, o.report.full_name, sitioName(o.report.sitio_id), o.report.sex ?? '',
      o.report.approx_age ?? '', matchLabels[o.classification], best ? fullName(best.resident) : '', best?.score ?? '',
      best?.resident.center_name ?? '', o.report.last_seen_location, o.report.reporter_name, o.report.reported_at, o.report.notes])
  }
  for (const r of result.closed) {
    rows.push(['Closed report', r.report_id, r.full_name, sitioName(r.sitio_id), r.sex ?? '', r.approx_age ?? '',
      r.status === 'found' ? 'Found' : 'Withdrawn', '', '', '', r.last_seen_location, r.reporter_name, r.reported_at,
      r.reconciliation_note ?? ''])
  }
  for (const r of result.unaccounted) {
    rows.push(['Unaccounted (not reported)', '', fullName(r), sitioName(r.sitio_id), r.sex ?? '', '',
      r.latest_status ? statusLabels[r.latest_status] : 'No evacuation record', '', '', r.center_name ?? '', '', '', '', ''])
  }
  for (const r of result.rescued) {
    rows.push(['Master rescued directory', '', fullName(r), sitioName(r.sitio_id), r.sex ?? '', '',
      'Safely evacuated', '', '', r.center_name ?? '', '', '', r.evacuated_at ?? r.latest_logged_at ?? '', ''])
  }
  return '﻿' + [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n')
}
