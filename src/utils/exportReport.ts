import type { Alert, EvacuationCenter, Resident, StatCardData } from '../types/dashboard'

type ExportReportArgs = {
  stats: StatCardData[]
  residents: Resident[]
  alerts: Alert[]
  evacuationCenters: EvacuationCenter[]
}

// Main export function called when the user clicks the Export Report button.
export function exportReport({
  stats,
  residents,
  alerts,
  evacuationCenters,
}: ExportReportArgs) {
  // Each section becomes part of the same CSV file.
  const reportSections = [
    buildSummarySection(stats),
    buildResidentsSection(residents),
    buildAlertsSection(alerts),
    buildEvacuationCentersSection(evacuationCenters),
  ]

  const csvContent = reportSections.join('\n\n')
  const fileName = `prioritycare-report-${getTodayString()}.csv`

  downloadCsvFile(fileName, csvContent)
}

// Creates the Summary section of the CSV.
function buildSummarySection(stats: StatCardData[]) {
  const rows = [
    ['Summary'],
    ['Metric', 'Value', 'Note'],
    ...stats.map((stat) => [stat.label, String(stat.value), stat.note]),
  ]

  return rows.map(formatCsvRow).join('\n')
}

// Creates the Residents section of the CSV.
function buildResidentsSection(residents: Resident[]) {
  const rows = [
    ['Residents'],
    ['Name', 'Sitio', 'Constraint', 'Status', 'Flood Zone', 'Last Updated'],
    ...residents.map((resident) => [
      resident.name,
      resident.sitio,
      resident.constraint,
      resident.status,
      resident.floodZone ? 'Yes' : 'No',
      resident.lastUpdated,
    ]),
  ]

  return rows.map(formatCsvRow).join('\n')
}

// Creates the Alerts section of the CSV.
function buildAlertsSection(alerts: Alert[]) {
  const rows = [
    ['Alerts'],
    ['Title', 'Time', 'Priority'],
    ...alerts.map((alert) => [alert.title, alert.time, alert.priority]),
  ]

  return rows.map(formatCsvRow).join('\n')
}

// Creates the Evacuation Centers section of the CSV.
function buildEvacuationCentersSection(evacuationCenters: EvacuationCenter[]) {
  const rows = [
    ['Evacuation Centers'],
    ['Name', 'Capacity', 'Occupied', 'Status'],
    ...evacuationCenters.map((center) => [
      center.name,
      String(center.capacity),
      String(center.occupied),
      center.status,
    ]),
  ]

  return rows.map(formatCsvRow).join('\n')
}

// Converts one array of values into a CSV row.
function formatCsvRow(values: string[]) {
  return values.map(formatCsvCell).join(',')
}

// Escapes quotes so commas and special characters do not break the CSV.
function formatCsvCell(value: string) {
  const escapedValue = value.replaceAll('"', '""')
  return `"${escapedValue}"`
}

// Creates a temporary link and clicks it to download the CSV file.
function downloadCsvFile(fileName: string, csvContent: string) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()

  URL.revokeObjectURL(url)
}

// Returns today's date for the report file name.
function getTodayString() {
  return new Date().toISOString().slice(0, 10)
}
