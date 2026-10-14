import { ageAt, inReportWindow, type RdanaData } from './rdana.ts'
import { calculateReliefDemand } from './reliefDemand.ts'
import { parseReliefReportDraft, type ReliefReportDraft } from './reliefReportDraft.ts'

export type ReportCell = string | number
export type ReportTable = { name: string; scope: string; headers: string[]; rows: ReportCell[][] }
export type DromicReport = {
  generatedAt: string; start: string; end: string; scope: string; context: string
  tables: ReportTable[]; relief: ReliefReportDraft | null
}
const unique = <T>(rows: T[], key: (row: T) => string) => [...new Map(rows.map((row) => [key(row), row])).values()]
export function buildDromicReport(data: RdanaData, context: string, relief: ReliefReportDraft | null): DromicReport {
  if (relief) parseReliefReportDraft(JSON.stringify(relief))
  const residents = unique(data.residents, (row) => row.uid)
  const ages = residents.map((row) => ageAt(row.birthdate, data.window.end))
  const profiles = data.profiles.available ? unique(data.profiles.data, (row) => row.resident_uid) : null
  const unavailable = 'Not available'
  const sos = data.sos.available ? unique(data.sos.data.filter((row) => inReportWindow(row.created_at, data.window)), (row) => row.alert_id) : null
  const completed = data.completedEvacuations.available ? unique(data.completedEvacuations.data.filter((row) => row.evac_status === 'safely_evacuated' && inReportWindow(row.evacuated_at, data.window)), (row) => row.record_id) : null
  const population: ReportTable = { name: 'Population', scope: `Current registered resident accounts: ${data.scope}. Not assessed disaster-affected population.`, headers: ['Metric', 'Count', 'Basis / gaps'], rows: [
    ['Registered resident accounts', residents.length, 'Current sitio registration; not an affected-person count'],
    ['Linked registered households', profiles ? new Set(profiles.map((row) => row.household_id).filter(Boolean)).size : unavailable, 'Unique linked households; not an affected-family count'],
    ['Male resident accounts', residents.filter((row) => row.sex === 'male').length, 'Recorded sex'],
    ['Female resident accounts', residents.filter((row) => row.sex === 'female').length, 'Recorded sex'],
    ['Sex not recorded / unknown', residents.filter((row) => !['male','female'].includes(row.sex ?? '')).length, 'Not inferred'],
    ['Infants under 1', ages.filter((age) => age !== null && age < 1).length, 'Age as of reporting end (Asia/Manila)'],
    ['Children ages 1-4', ages.filter((age) => age !== null && age >= 1 && age < 5).length, 'Separate from infants'],
    ['Residents age 60+', ages.filter((age) => age !== null && age >= 60).length, 'Age as of reporting end'],
    ['Birthdate unknown / invalid', ages.filter((age) => age === null).length, 'Not counted in age bands'],
    ['Non-ambulatory', residents.filter((row) => row.mobility_status === 'non_ambulatory').length, 'Recorded mobility'],
    ['Semi-ambulatory', residents.filter((row) => row.mobility_status === 'semi_ambulatory').length, 'Recorded mobility'],
    ['Recorded disability categories', data.disabilityResidents.available ? new Set(data.disabilityResidents.data).size : unavailable, 'Accounts with one or more categories; missing linkage does not establish absence'],
    ['Recorded pregnancy', profiles ? profiles.filter((row) => row.is_pregnant).length : unavailable, 'Not inferred from sex or age'],
    ['Missing supplemental assessments', profiles ? residents.filter((row) => !profiles.some((profile) => profile.resident_uid === row.uid)).length : unavailable, 'Pregnancy/needs may be unknown for these accounts'],
    ['Dependent population', 'Not assessed', 'Dependents without resident accounts are excluded from account counts'],
    ['Total affected people / families', 'Not assessed', 'Requires disaster assessment and event linkage'],
  ] }
  const shelters: ReportTable = { name: 'Shelters', scope: 'Current shared facilities across all sitios, at retrieval. Not historical occupancy for the reporting window.', headers: ['Facility', 'Status', 'Safe capacity', 'Recorded evacuees', 'Available slots'], rows: [] }
  if (data.shelters.available) {
    shelters.rows = unique(data.shelters.data, (row) => String(row.center_id)).map((center) => [
      center.center_name ?? `Facility ${center.center_id}`, center.status ?? 'Unknown', center.capacity ?? 'Not set', center.occupied,
      center.status === 'closed' ? 'Closed' : center.status === 'active' && center.capacity !== null ? Math.max(0, center.capacity - center.occupied) : 'Unknown',
    ])
    if (!shelters.rows.length) shelters.rows.push(['No recorded facilities', '', '', '', ''])
  } else shelters.rows.push([unavailable, data.shelters.reason, unavailable, unavailable, unavailable])
  const reliefTable: ReportTable = { name: 'Relief', scope: relief ? `Planning date ${relief.date}; saved ${relief.savedAt}. ${relief.scope}. Estimates, not distributions.` : 'No saved relief planning draft. Actual distributions and assistance costs are not recorded.', headers: ['Facility / item', 'People', 'Household allocations', 'FFPs to request', 'Water L to request', 'Hygiene kits to request'], rows: [] }
  if (relief) {
    reliefTable.rows = relief.rows.map((row) => {
      const { request } = calculateReliefDemand({ people: row.people, households: row.households }, relief.rates, row.stock)
      return [row.centerName, row.people, row.households, request.ffps, request.waterLiters, request.hygieneKits]
    })
    reliefTable.rows.push(['TOTAL PLANNED REQUEST', '', '', ...[3,4,5].map((column) => reliefTable.rows.reduce((sum, row) => sum + Number(row[column]), 0))])
  } else reliefTable.rows.push(['No saved planning draft', unavailable, unavailable, unavailable, unavailable, unavailable])
  const summary: ReportTable = { name: 'Summary', scope: `Period activity: ${data.scope}. Shelter and population sections are current snapshots.`, headers: ['Metric', 'Value', 'Interpretation'], rows: [
    ['Reporting window (hours)', data.window.hours, 'Creation/completion timestamps; start inclusive, end exclusive'],
    ['SOS alerts created in period', sos?.length ?? unavailable, data.sos.available ? 'Distinct alerts, not rescued people' : data.sos.reason],
    ['Resident accounts reporting SOS', sos ? new Set(sos.map((row) => row.resident_uid)).size : unavailable, 'Distinct accounts within this sitio'],
    ['Safely-evacuated records completed in period', completed?.length ?? unavailable, data.completedEvacuations.available ? 'Requires completion timestamp and current safely_evacuated status' : data.completedEvacuations.reason],
    ['Deaths / injuries / missing persons', 'Not assessed', 'Do not infer missing persons from failed evacuation records'],
    ['Housing / infrastructure damage', 'Not assessed', 'No damage-assessment records'],
    ['Actual relief distributions / costs', 'Not recorded', 'Planning quantities are not distributions or expenditure'],
    ['Official DSWD-DROMIC template compliance', 'Not established', 'No required official template was supplied'],
    ['Incident notes', context.trim() || 'Not assessed', 'Administrator-provided context, not independently verified'],
    ['Reviewer / office', 'Pending review', 'Local export, not an official submission'],
  ] }
  return { generatedAt: data.fetchedAt, start: data.window.start, end: data.window.end, scope: data.scope, context, tables: [summary,population,shelters,reliefTable], relief }
}
