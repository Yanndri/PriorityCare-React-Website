import { ageAt } from './rdana.ts'

// Appendix N, Module 3 — Reconcile the Master Rescued Directory against the
// Missing Persons Manifest. Input is the scoped payload of the existing
// get_rescue_reconciliation() RPC. Matching is identity-based: a report is only
// treated as matching the rescued directory through a recorded resident ID.
// Name agreement alone never produces a match; it can only raise a
// "possible match" that an administrator must verify.

export type MissingReport = {
  report_id: string
  barangay_id: number
  event_id: string | null
  resident_uid: string | null
  full_name: string
  sex: string | null
  approx_age: number | null
  last_seen_location: string
  last_seen_at: string | null
  notes: string
  status: 'missing' | 'found' | 'withdrawn'
  matched_resident_uid: string | null
  reconciled_at: string | null
  reconciliation_note: string | null
  reported_at: string
}

export type DirectoryResident = {
  uid: string
  barangay_id: number
  f_name: string | null
  m_name: string | null
  l_name: string | null
  sex: string | null
  birthdate: string | null
  latest_status: string | null
  latest_logged_at: string | null
  evacuated_at: string | null
  center_id: number | null
  center_name: string | null
}

export type ReconciliationData = {
  generated_at: string
  barangays: { barangay_id: number; barangay_name: string }[]
  events: { event_id: string; barangay_id: number; name: string; hazard_type: string; status: string; started_at: string }[]
  reports: MissingReport[]
  residents: DirectoryResident[]
}

export type Outcome =
  | 'closed_matched' // closed as found with a recorded directory match
  | 'closed_note' // closed as found by note, without a directory match
  | 'withdrawn'
  | 'ready_to_close' // open, ID-linked resident is in the rescued directory
  | 'possible_match' // open, unlinked; corroborated name candidate(s) need verification
  | 'unresolved' // open, no rescued-directory evidence

export const outcomeLabels: Record<Outcome, string> = {
  closed_matched: 'Found — matched to rescued directory',
  closed_note: 'Found — closed by note (no directory match)',
  withdrawn: 'Withdrawn',
  ready_to_close: 'Open — linked resident is in rescued directory',
  possible_match: 'Open — possible match, needs verification',
  unresolved: 'Open — unresolved',
}

export type Candidate = {
  resident: DirectoryResident
  rescued: boolean
  age: number | null
  evidence: string
}

export type ReconciledReport = {
  report: MissingReport
  outcome: Outcome
  linkedResident: DirectoryResident | null
  candidates: Candidate[]
  evidence: string
  discrepancies: string[]
}

export type ReconciliationResult = {
  rows: ReconciledReport[]
  rescuedDirectory: DirectoryResident[]
  counts: Record<Outcome, number> & {
    open: number
    discrepancies: number
    residentsInScope: number
    residentsWithoutRecord: number
  }
}

export const RESCUED_STATUS = 'safely_evacuated'
const AGE_TOLERANCE = 2

export function isRescued(resident: DirectoryResident | null | undefined) {
  return resident?.latest_status === RESCUED_STATUS
}

export function residentName(resident: DirectoryResident) {
  return [resident.f_name, resident.m_name, resident.l_name]
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .join(' ') || `Resident ${resident.uid}`
}

function nameTokens(value: string | null | undefined) {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter(Boolean)
}

// A report name "agrees" with a resident only when every token of the
// resident's recorded first name and last name appears in the report name.
// This is exact token equality, not a similarity score.
export function namesAgree(reportName: string, resident: DirectoryResident) {
  const report = new Set(nameTokens(reportName))
  const required = [...nameTokens(resident.f_name), ...nameTokens(resident.l_name)]
  return nameTokens(resident.l_name).length > 0 && required.length > 0 && required.every((token) => report.has(token))
}

function normalizedSex(value: string | null | undefined) {
  const sex = (value ?? '').trim().toLowerCase()
  return sex === 'male' || sex === 'female' ? sex : null
}

export function reconcile(data: ReconciliationData, asOf = data.generated_at): ReconciliationResult {
  const residentsById = new Map(data.residents.map((resident) => [resident.uid, resident]))
  const rescuedDirectory = data.residents.filter(isRescued)

  // Open reports that share a resident link or normalized name in the same barangay.
  const openKeys = new Map<string, number>()
  const keyOf = (report: MissingReport) =>
    report.resident_uid ? `uid:${report.resident_uid}` : `name:${report.barangay_id}:${nameTokens(report.full_name).sort().join(' ')}`
  for (const report of data.reports) {
    if (report.status === 'missing') openKeys.set(keyOf(report), (openKeys.get(keyOf(report)) ?? 0) + 1)
  }

  const rows = data.reports.map<ReconciledReport>((report) => {
    const discrepancies: string[] = []
    const linkedId = report.matched_resident_uid ?? report.resident_uid
    const linkedResident = linkedId ? residentsById.get(linkedId) ?? null : null
    if (linkedId && !linkedResident) {
      discrepancies.push('Linked resident is not in the scoped resident registry (transferred or removed).')
    }
    if (report.status === 'missing' && (openKeys.get(keyOf(report)) ?? 0) > 1) {
      discrepancies.push('Possible duplicate: another open report has the same resident link or name in this barangay.')
    }

    if (report.status === 'withdrawn') {
      return { report, outcome: 'withdrawn', linkedResident, candidates: [], evidence: report.reconciliation_note ?? 'Withdrawn', discrepancies }
    }

    if (report.status === 'found') {
      if (report.matched_resident_uid) {
        if (linkedResident && !isRescued(linkedResident)) {
          discrepancies.push(`Matched resident's latest evacuation record is now "${linkedResident.latest_status ?? 'none'}", not safely evacuated.`)
        }
        return {
          report, outcome: 'closed_matched', linkedResident, candidates: [],
          evidence: `Closed with recorded resident ID match. ${report.reconciliation_note ?? ''}`.trim(), discrepancies,
        }
      }
      return {
        report, outcome: 'closed_note', linkedResident, candidates: [],
        evidence: report.reconciliation_note ? `Closed by note: ${report.reconciliation_note}` : 'Closed without a directory match or note.',
        discrepancies,
      }
    }

    // Open report linked to a registered resident by ID.
    if (report.resident_uid) {
      if (linkedResident && isRescued(linkedResident)) {
        discrepancies.push('Report is still open although the linked resident is recorded as safely evacuated.')
        return {
          report, outcome: 'ready_to_close', linkedResident, candidates: [],
          evidence: `Linked by resident ID; latest record safely evacuated${linkedResident.center_name ? ` at ${linkedResident.center_name}` : ''}. Verify identity, then close the report.`,
          discrepancies,
        }
      }
      return {
        report, outcome: 'unresolved', linkedResident, candidates: [],
        evidence: linkedResident
          ? `Linked by resident ID; latest evacuation record: ${linkedResident.latest_status ?? 'none recorded'}.`
          : 'Linked resident could not be found in scope.',
        discrepancies,
      }
    }

    // Unlinked open report: look for corroborated candidates only.
    const reportSex = normalizedSex(report.sex)
    const candidates: Candidate[] = []
    let conflicting = 0
    let nameOnly = 0
    for (const resident of data.residents) {
      if (resident.barangay_id !== report.barangay_id || !namesAgree(report.full_name, resident)) continue
      const age = ageAt(resident.birthdate, asOf)
      const residentSex = normalizedSex(resident.sex)
      const sexKnown = reportSex !== null && residentSex !== null
      const ageKnown = report.approx_age !== null && age !== null
      const sexConflict = sexKnown && reportSex !== residentSex
      const ageConflict = ageKnown && Math.abs(report.approx_age! - age!) > AGE_TOLERANCE
      if (sexConflict || ageConflict) { conflicting++; continue }
      if (!sexKnown && !ageKnown) { nameOnly++; continue }
      candidates.push({
        resident, rescued: isRescued(resident), age,
        evidence: ['name', sexKnown ? 'sex' : '', ageKnown ? `age (±${AGE_TOLERANCE})` : ''].filter(Boolean).join(' + ') + ' agree',
      })
    }
    if (conflicting) discrepancies.push(`${conflicting} registered resident(s) share the name but have conflicting sex or age; not treated as matches.`)
    if (nameOnly) discrepancies.push(`${nameOnly} registered resident(s) share the name only; sex and age are not recorded on both sides, so this is insufficient to match.`)
    if (candidates.length > 1) discrepancies.push('More than one corroborated candidate; identity must be confirmed in person.')

    if (candidates.length) {
      const rescuedCount = candidates.filter((candidate) => candidate.rescued).length
      return {
        report, outcome: 'possible_match', linkedResident: null, candidates,
        evidence: `${candidates.length} candidate(s) with corroborating details; ${rescuedCount} in the rescued directory. Not a confirmed match — verify identity before linking.`,
        discrepancies,
      }
    }
    return {
      report, outcome: 'unresolved', linkedResident: null, candidates: [],
      evidence: 'Not linked to a registered resident and no corroborated directory candidate.',
      discrepancies,
    }
  })

  const counts = {
    closed_matched: 0, closed_note: 0, withdrawn: 0, ready_to_close: 0, possible_match: 0, unresolved: 0,
    open: 0, discrepancies: 0,
    residentsInScope: data.residents.length,
    residentsWithoutRecord: data.residents.filter((resident) => !resident.latest_status).length,
  }
  for (const row of rows) {
    counts[row.outcome]++
    if (row.report.status === 'missing') counts.open++
    if (row.discrepancies.length) counts.discrepancies++
  }
  return { rows, rescuedDirectory, counts }
}

export function manilaTime(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Not recorded'
  return new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export function reconciliationTables(data: ReconciliationData, result: ReconciliationResult) {
  const barangayName = new Map(data.barangays.map((barangay) => [barangay.barangay_id, barangay.barangay_name]))
  const eventName = new Map(data.events.map((event) => [event.event_id, `${event.name} (${event.hazard_type})`]))
  const manifest = {
    name: 'Manifest reconciliation',
    headers: ['Report ID', 'Reported name', 'Barangay', 'Disaster event', 'Reported (Asia/Manila)', 'Last seen', 'Report status', 'Reconciliation outcome', 'Linked / matched resident', 'Resident latest evacuation status', 'Corroborated candidates', 'Evidence', 'Discrepancies'],
    rows: result.rows.map((row) => [
      row.report.report_id,
      row.report.full_name,
      barangayName.get(row.report.barangay_id) ?? `Barangay ${row.report.barangay_id}`,
      row.report.event_id ? eventName.get(row.report.event_id) ?? row.report.event_id : 'Not linked',
      manilaTime(row.report.reported_at),
      [row.report.last_seen_location, row.report.last_seen_at ? manilaTime(row.report.last_seen_at) : ''].filter(Boolean).join(' — ') || 'Not recorded',
      row.report.status,
      outcomeLabels[row.outcome],
      row.linkedResident ? `${residentName(row.linkedResident)} (${row.linkedResident.uid})` : row.report.matched_resident_uid ?? row.report.resident_uid ?? 'Not linked',
      row.linkedResident ? row.linkedResident.latest_status ?? 'No evacuation record' : 'Not applicable',
      row.candidates.map((candidate) => `${residentName(candidate.resident)} (${candidate.resident.uid}; ${candidate.evidence}; ${candidate.rescued ? 'rescued' : candidate.resident.latest_status ?? 'no record'})`).join('\n') || 'None',
      row.evidence,
      row.discrepancies.join('\n') || 'None',
    ]),
  }
  const directory = {
    name: 'Master rescued directory',
    headers: ['Resident ID', 'Name', 'Barangay', 'Evacuation center', 'Evacuated at (Asia/Manila)', 'Record logged at (Asia/Manila)'],
    rows: result.rescuedDirectory.map((resident) => [
      resident.uid, residentName(resident), barangayName.get(resident.barangay_id) ?? `Barangay ${resident.barangay_id}`,
      resident.center_name ?? 'Not recorded', manilaTime(resident.evacuated_at), manilaTime(resident.latest_logged_at),
    ]),
  }
  return [manifest, directory]
}
