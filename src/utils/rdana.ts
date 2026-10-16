export type ReportWindow = { hours: 24 | 48; start: string; end: string }
export type ReportSection<T> = { available: true; data: T } | { available: false; reason: string }
export type SosReportRow = { alert_id: string; resident_uid: string; status: string | null; created_at: string }
export type EvacReportRow = { record_id: string; resident_uid: string; evac_status: string; logged_at: string | null; evacuated_at: string | null }
export type ShelterReportRow = { center_id: number; center_name?: string; capacity: number | null; occupied: number; status?: string }
export type ResidentReportRow = { uid: string; birthdate: string | null; sex?: string | null; mobility_status: string | null }
export type ProfileReportRow = { resident_uid: string; is_pregnant: boolean; household_id: string | null; vulnerability_needs: string }
export type ManifestReportRow = { report_id: string; status: string; reported_at: string; reconciled_at: string | null }
export type DeclaredEventRow = { event_id: string; name: string; hazard_type: string; status: string; started_at: string; resolved_at: string | null }
export type RdanaData = {
  window: ReportWindow
  scope: string
  fetchedAt: string
  residents: ResidentReportRow[]
  profiles: ReportSection<ProfileReportRow[]>
  disabilityResidents: ReportSection<string[]>
  sos: ReportSection<SosReportRow[]>
  loggedEvacuations: ReportSection<EvacReportRow[]>
  completedEvacuations: ReportSection<EvacReportRow[]>
  shelters: ReportSection<ShelterReportRow[]>
  // Optional so earlier callers keep their previous "Not assessed" wording.
  missingReports?: ReportSection<ManifestReportRow[]>
  declaredEvents?: ReportSection<DeclaredEventRow[]>
}
export function makeReportWindow(hours: 24 | 48, end = new Date().toISOString()): ReportWindow {
  if (![24, 48].includes(hours) || !Number.isFinite(Date.parse(end))) throw new Error('Choose a valid 24- or 48-hour window.')
  return { hours, start: new Date(Date.parse(end) - hours * 3_600_000).toISOString(), end: new Date(end).toISOString() }
}
export function inReportWindow(value: string | null, window: ReportWindow) {
  const timestamp = value ? Date.parse(value) : NaN
  return Number.isFinite(timestamp) && timestamp >= Date.parse(window.start) && timestamp < Date.parse(window.end)
}
export async function readReportPages<T>(read: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, size = 500, maxPages = 100): Promise<T[]> {
  const result: T[] = []
  for (let page = 0; page < maxPages; page++) {
    const { data, error } = await read(page * size, (page + 1) * size - 1)
    if (error) throw new Error(error.message)
    if (data === null) throw new Error('The data source returned no readable result.')
    result.push(...data)
    if (data.length < size) return result
  }
  throw new Error('Report data exceeds the retrieval limit. Narrow the scope before generating a complete report.')
}
const unique = <T>(rows: T[], key: (row: T) => string) => [...new Map(rows.map((row) => [key(row), row])).values()]
function manila(value: string) {
  return new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}
function unavailable(reason: string) { return `Not available — ${reason}` }
// Missing-person manifest activity: filed/closed timestamps inside the window,
// plus reports still open at retrieval (current status, not a casualty count).
export function manifestActivity(rows: ManifestReportRow[], window: ReportWindow) {
  const reports = unique(rows, (row) => row.report_id)
  return {
    filed: reports.filter((row) => inReportWindow(row.reported_at, window)).length,
    found: reports.filter((row) => row.status === 'found' && inReportWindow(row.reconciled_at, window)).length,
    withdrawn: reports.filter((row) => row.status === 'withdrawn' && inReportWindow(row.reconciled_at, window)).length,
    openNow: reports.filter((row) => row.status === 'missing').length,
  }
}
// Declared events whose active interval overlaps the reporting window.
export function eventsDuringWindow(rows: DeclaredEventRow[], window: ReportWindow) {
  return unique(rows, (row) => row.event_id).filter((row) => {
    const started = Date.parse(row.started_at)
    const resolved = row.resolved_at ? Date.parse(row.resolved_at) : Infinity
    return Number.isFinite(started) && started < Date.parse(window.end) && resolved >= Date.parse(window.start)
  }).sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at))
}
export function ageAt(birthdate: string | null, end: string) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(end))
  if (!birthdate || !/^\d{4}-\d{2}-\d{2}$/.test(birthdate) || birthdate > day) return null
  const parsed = new Date(`${birthdate}T00:00:00Z`)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== birthdate) return null
  return Number(day.slice(0, 4)) - Number(birthdate.slice(0, 4)) - (day.slice(5) < birthdate.slice(5) ? 1 : 0)
}
export function buildRdanaSummary(data: RdanaData, context = '') {
  const residents = unique(data.residents, (row) => row.uid)
  const ages = residents.map((row) => ageAt(row.birthdate, data.window.end))
  const lines = [
    'PRIORITYCARE — RDANA SITUATION SUMMARY',
    'PROTOTYPE DRAFT — administrator review required; not an official completed RDANA form.',
    `Reporting period: ${manila(data.window.start)} to ${manila(data.window.end)} (Asia/Manila)`,
    `Window: ${data.window.hours} hours; start inclusive, end exclusive.`,
    `Geographic population scope: ${data.scope} (residents currently registered in this sitio).`,
    `Retrieved: ${manila(data.fetchedAt)} (Asia/Manila)`,
    '',
    '1. INCIDENT / ASSESSMENT CONTEXT',
    context.trim() ? `Administrator-provided context (not independently verified):\n${context.trim()}` : 'Disaster event, onset, and assessed affected area: Not assessed.',
  ]
  if (data.declaredEvents?.available) {
    const events = eventsDuringWindow(data.declaredEvents.data, data.window)
    lines.push(events.length
      ? `Declared disaster events active during the period (register; sitio-scoped): ${events.length}.`
      : 'Declared disaster events active during the period: none recorded in the register.')
    for (const event of events) lines.push(`- ${event.name} — ${event.hazard_type}; onset ${manila(event.started_at)}; ${event.status === 'resolved' && event.resolved_at ? `resolved ${manila(event.resolved_at)}` : 'still active at retrieval'}.`)
    if (events.length) lines.push('Declarations are reference records; affected areas are not assessed and individual records are not attributed to an event.')
  } else if (data.declaredEvents) lines.push(`Declared disaster events: ${unavailable(data.declaredEvents.reason)}.`)
  lines.push('', '2. RECORDED ACTIVITY DURING THE REPORTING PERIOD')
  if (data.sos.available) {
    const sos = unique(data.sos.data.filter((row) => inReportWindow(row.created_at, data.window)), (row) => row.alert_id)
    lines.push(`SOS alerts created: ${sos.length}; distinct reporting resident accounts: ${new Set(sos.map((row) => row.resident_uid)).size}.`)
    const statuses = new Map<string, number>()
    for (const row of sos) statuses.set(row.status ?? 'not recorded', (statuses.get(row.status ?? 'not recorded') ?? 0) + 1)
    lines.push(`Current status of those alerts: ${[...statuses].map(([status, n]) => `${status}: ${n}`).join('; ') || 'No dated alerts in this window'}.`)
  } else lines.push(`SOS activity: ${unavailable(data.sos.reason)}.`)
  if (data.loggedEvacuations.available) {
    const rows = unique(data.loggedEvacuations.data.filter((row) => inReportWindow(row.logged_at, data.window)), (row) => row.record_id)
    lines.push(`Evacuation records logged: ${rows.length}; distinct resident accounts: ${new Set(rows.map((row) => row.resident_uid)).size}.`)
    lines.push(`Of these records, current statuses are pending: ${rows.filter((row) => row.evac_status === 'pending').length}; in transit: ${rows.filter((row) => row.evac_status === 'in_transit').length}; safely evacuated: ${rows.filter((row) => row.evac_status === 'safely_evacuated').length}; failed: ${rows.filter((row) => row.evac_status === 'failed').length}.`)
    const undated = rows.filter((row) => row.evac_status === 'safely_evacuated' && (!row.evacuated_at || !Number.isFinite(Date.parse(row.evacuated_at)))).length
    if (undated) lines.push(`Data gap: ${undated} safely-evacuated record(s) logged in this window have no valid completion timestamp.`)
  } else lines.push(`Evacuation logging activity: ${unavailable(data.loggedEvacuations.reason)}.`)
  if (data.completedEvacuations.available) {
    const completed = unique(data.completedEvacuations.data.filter((row) => row.evac_status === 'safely_evacuated' && inReportWindow(row.evacuated_at, data.window)), (row) => row.record_id)
    lines.push(`Safely-evacuated records with completion timestamps in the period: ${completed.length}; distinct resident accounts: ${new Set(completed.map((row) => row.resident_uid)).size}.`)
  } else lines.push(`Timestamped evacuation completions: ${unavailable(data.completedEvacuations.reason)}.`)
  lines.push('', '3. CURRENT REGISTERED POPULATION SNAPSHOT (NOT AFFECTED-POPULATION TOTALS)',
    `Registered resident accounts in scope: ${residents.length}.`,
    `Age under 1: ${ages.filter((age) => age !== null && age < 1).length}; ages 1–4: ${ages.filter((age) => age !== null && age >= 1 && age < 5).length}; age 60+: ${ages.filter((age) => age !== null && age >= 60).length}; unknown/invalid birthdate: ${ages.filter((age) => age === null).length}.`,
    `Recorded mobility: non-ambulatory ${residents.filter((row) => row.mobility_status === 'non_ambulatory').length}; semi-ambulatory ${residents.filter((row) => row.mobility_status === 'semi_ambulatory').length}.`)
  if (data.profiles.available) {
    const profileIds = new Set(data.profiles.data.map((row) => row.resident_uid))
    lines.push(`Recorded pregnancy: ${data.profiles.data.filter((row) => row.is_pregnant).length}; accounts without supplemental assessment: ${residents.filter((row) => !profileIds.has(row.uid)).length}.`)
    lines.push(`Distinct linked registered households: ${new Set(data.profiles.data.map((row) => row.household_id).filter(Boolean)).size}; accounts without household linkage: ${residents.filter((row) => !data.profiles.available || !data.profiles.data.some((profile) => profile.resident_uid === row.uid && profile.household_id)).length}.`)
    lines.push(`Accounts with recorded assistance notes: ${data.profiles.data.filter((row) => row.vulnerability_needs?.trim()).length}.`)
  } else lines.push(`Pregnancy, household linkage, and supplemental needs: ${unavailable(data.profiles.reason)}.`)
  lines.push(data.disabilityResidents.available ? `Resident accounts with recorded disability categories: ${new Set(data.disabilityResidents.data).size}. No record does not prove an assessed absence.` : `Disability records: ${unavailable(data.disabilityResidents.reason)}.`)
  lines.push('Dependent household members without resident accounts are not included in these account counts.', '', '4. CURRENT SHARED SHELTER SNAPSHOT (ALL SITIOS, AT RETRIEVAL)')
  if (data.shelters.available) {
    const centers = unique(data.shelters.data, (row) => String(row.center_id))
    const active = centers.filter((center) => center.status === 'active')
    const known = active.filter((center) => center.capacity !== null && center.capacity > 0)
    lines.push(`Shared facilities: ${centers.length}; active ${active.length}; closed ${centers.filter((center) => center.status === 'closed').length}; unknown lifecycle status ${centers.filter((center) => !['active','closed'].includes(center.status ?? '')).length}.`)
    lines.push(`Current recorded occupancy in active facilities: ${active.reduce((sum, center) => sum + center.occupied, 0)}; reviewed capacity across known active facilities: ${known.reduce((sum, center) => sum + center.capacity!, 0)}; known available slots: ${known.reduce((sum, center) => sum + Math.max(0, center.capacity! - center.occupied), 0)}.`)
    lines.push(`Active facilities with capacity not set: ${active.length - known.length}; at or above capacity: ${known.filter((center) => center.occupied >= center.capacity!).length}.`)
  } else lines.push(`Shelter snapshot: ${unavailable(data.shelters.reason)}.`)
  lines.push('', '5. DAMAGE, NEEDS, AND VALIDATION GAPS')
  if (data.missingReports?.available) {
    const manifest = manifestActivity(data.missingReports.data, data.window)
    lines.push(`Missing-person manifest (sitio-scoped): reports filed in period ${manifest.filed}; marked found in period ${manifest.found}; withdrawn in period ${manifest.withdrawn}; open reports at retrieval ${manifest.openNow}. Open reports are unresolved cases, not a casualty count.`)
  } else if (data.missingReports) lines.push(`Missing-person manifest: ${unavailable(data.missingReports.reason)}.`)
  lines.push(data.missingReports
    ? 'Deaths, injuries, damaged homes, infrastructure damage, and total disaster-affected people/families: Not assessed.'
    : 'Deaths, injuries, missing persons, damaged homes, infrastructure damage, and total disaster-affected people/families: Not assessed.',
    'Daily FFP, potable-water, and hygiene-kit requisitions: Not available in this report. Relief-planner drafts are not persisted; attach a reviewed daily requisition export separately.',
    'Disaster-event attribution: Not assessed. Time-window activity may involve multiple incidents.',
    'SOS status does not establish rescue completion; failed evacuation records do not establish a missing person.',
    '', '6. METHOD AND REVIEW',
    'Activity is based on stored creation, logging, or completion timestamps. Records without the relevant timestamp are excluded from window totals.',
    'Statuses are current recorded values, not a reconstruction of status changes during the reporting period.',
    'Population scope follows current sitio registration. Shelter figures are facility-wide and must not be added to registered population totals.',
    'Data is retrieved in multiple read-only queries, not one transactional snapshot. Later transfers, profile edits, and status changes can affect the next generated draft.',
    '',
    '7. DATA SOURCES',
    `Registered residents (sitio registry): retrieved, ${residents.length} account(s).`,
    ...([
      ['SOS alerts (creation time)', data.sos],
      ['Evacuation records (logged time)', data.loggedEvacuations],
      ['Evacuation records (completion time)', data.completedEvacuations],
      ['Supplemental resident assessments', data.profiles],
      ['Resident disability categories', data.disabilityResidents],
      ['Evacuation facility catalog (all sitios)', data.shelters],
      ...(data.declaredEvents ? [['Disaster event register', data.declaredEvents] as const] : []),
      ...(data.missingReports ? [['Missing-person manifest', data.missingReports] as const] : []),
    ] as const).map(([label, section]) => `${label}: ${section.available ? 'retrieved' : unavailable(section.reason)}.`),
    '',
    'Reviewer / office: ____________________    Review date: ____________________',
    'Approval / distribution: Pending administrator review.',
  )
  return lines.join('\n')
}
