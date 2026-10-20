import { supabase } from '../lib/supabaseClient'
import { makeReportWindow, readReportPages, type RdanaData, type ReportSection, type ResidentReportRow, type SosReportRow, type EvacReportRow, type ProfileReportRow, type ShelterReportRow, type ManifestReportRow, type DeclaredEventRow } from '../utils/rdana'

async function optional<T>(read: () => Promise<T>, reason: string): Promise<ReportSection<T>> {
  try { return { available: true, data: await read() } }
  catch { return { available: false, reason } }
}
async function byResidentChunks<T>(ids: string[], read: (ids: string[], from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = []
  for (let index = 0; index < ids.length; index += 100) {
    const chunk = ids.slice(index, index + 100)
    rows.push(...await readReportPages((from, to) => read(chunk, from, to)))
  }
  return rows
}
export async function fetchRdanaData(hours: 24 | 48): Promise<RdanaData> {
  const window = makeReportWindow(hours)
  const { data: auth, error: authError } = await supabase.auth.getUser()
  if (authError || !auth.user) throw new Error('Sign in again before generating a report.')
  const { data: actor, error: actorError } = await supabase.from('users')
    .select('role,account_status,assigned_barangay_id').eq('uid', auth.user.id).single()
  if (actorError || !actor || actor.account_status !== 'active' || !['admin','super_admin'].includes(actor.role)) throw new Error('Active administrator access is required.')
  if (actor.assigned_barangay_id == null) throw new Error('A barangay assignment is required for this scoped report.')
  const { data: barangay, error: barangayError } = await supabase.from('barangays').select('barangay_name').eq('barangay_id', actor.assigned_barangay_id).single()
  if (barangayError || !barangay) throw new Error('Unable to verify the report’s barangay scope.')
  const residents = await readReportPages<ResidentReportRow>((from, to) => supabase.from('residents')
    .select('uid,birthdate,sex,mobility_status').eq('barangay_id', actor.assigned_barangay_id).order('uid').range(from, to))
  const ids = residents.map((resident) => resident.uid)
  const columns = 'record_id,resident_uid,evac_status,logged_at,evacuated_at'
  const scopedBarangay = actor.assigned_barangay_id
  const [sos, loggedEvacuations, completedEvacuations, profiles, disabilityResidents, shelters, declaredEvents, missingReports] = await Promise.all([
    optional(() => byResidentChunks<SosReportRow>(ids, (chunk, from, to) => supabase.from('sos_alerts')
      .select('alert_id,resident_uid,status,created_at').in('resident_uid', chunk)
      .gte('created_at', window.start).lt('created_at', window.end).order('created_at').order('alert_id').range(from, to)), 'SOS data could not be retrieved completely.'),
    optional(() => byResidentChunks<EvacReportRow>(ids, (chunk, from, to) => supabase.from('evacuation_records').select(columns)
      .in('resident_uid', chunk).gte('logged_at', window.start).lt('logged_at', window.end).order('logged_at').order('record_id').range(from, to)), 'Evacuation logging data could not be retrieved completely.'),
    optional(() => byResidentChunks<EvacReportRow>(ids, (chunk, from, to) => supabase.from('evacuation_records').select(columns)
      .in('resident_uid', chunk).gte('evacuated_at', window.start).lt('evacuated_at', window.end).order('evacuated_at').order('record_id').range(from, to)), 'Timestamped evacuation-completion data could not be retrieved completely.'),
    optional(() => byResidentChunks<ProfileReportRow>(ids, (chunk, from, to) => supabase.from('resident_profile_details')
      .select('resident_uid,is_pregnant,household_id,vulnerability_needs').in('resident_uid', chunk).order('resident_uid').range(from, to)), 'Supplemental resident assessments could not be retrieved completely.'),
    optional(async () => (await byResidentChunks<{ resident_uid: string }>(ids, (chunk, from, to) => supabase.from('resident_disabilities')
      .select('resident_uid,disability_id').in('resident_uid', chunk).order('resident_uid').order('disability_id').range(from, to))).map((row) => row.resident_uid), 'Disability records could not be retrieved completely.'),
    optional(async () => {
      const { data, error } = await supabase.rpc('get_evacuation_facility_catalog')
      if (error || !Array.isArray(data)) throw new Error('Shelter catalog unavailable.')
      const names = await readReportPages<{ center_id: number; center_name: string }>((from, to) => supabase
        .from('evacuation_centers').select('center_id,center_name').order('center_id').range(from, to))
      const nameMap = new Map(names.map((row) => [row.center_id, row.center_name]))
      return (data as ShelterReportRow[]).map((row) => ({ ...row, center_name: nameMap.get(row.center_id) ?? `Facility ${row.center_id}` }))
    }, 'Shared shelter catalog is unavailable; verify the facility migrations and permissions.'),
    // Existing scoped RPCs; rows are narrowed to the assigned barangay so super admins get the same scope as the report.
    optional(async () => {
      const { data, error } = await supabase.rpc('get_disaster_event_register')
      if (error || !data || !Array.isArray(data.events)) throw new Error('Event register unavailable.')
      return (data.events as (DeclaredEventRow & { barangay_id: number })[]).filter((row) => row.barangay_id === scopedBarangay)
        .map(({ event_id, name, hazard_type, status, started_at, resolved_at }) => ({ event_id, name, hazard_type, status, started_at, resolved_at }))
    }, 'Disaster event register could not be retrieved.'),
    optional(async () => {
      const { data, error } = await supabase.rpc('get_rescue_reconciliation')
      if (error || !data || !Array.isArray(data.reports)) throw new Error('Manifest unavailable.')
      return (data.reports as (ManifestReportRow & { barangay_id: number })[]).filter((row) => row.barangay_id === scopedBarangay)
        .map(({ report_id, status, reported_at, reconciled_at }) => ({ report_id, status, reported_at, reconciled_at }))
    }, 'Missing-person manifest could not be retrieved.'),
  ])
  return { window, scope: `${barangay.barangay_name} (barangay ${actor.assigned_barangay_id})`, fetchedAt: new Date().toISOString(), residents, sos, loggedEvacuations, completedEvacuations, profiles, disabilityResidents, shelters, declaredEvents, missingReports }
}
