import { useMemo, useState } from 'react'
import type { EvacuationHistoryRecord } from '../types/dashboard'

// This line:

// filteredRecords.filter((record) =>

// means:

// Go through every item inside filteredRecords one by one.
// For each item, temporarily call it record.
// Keep only the records that match the condition inside the filter.

// Example from your Data Mining code:

// const unresolvedCases = filteredRecords.filter((record) =>
//   ['Pending', 'Missing / Relocated', 'In Transit'].includes(record.status),
// ).length

// This means:
// From the filtered evacuation records,
// keep only records where status is:
// Pending
// Missing / Relocated
// In Transit

// Then count how many matched using .length.

// So if your records are:

// [
//   { status: 'Safely Evacuated' },
//   { status: 'Pending' },
//   { status: 'In Transit' }
// ]

// The filter keeps:

// [
//   { status: 'Pending' },
//   { status: 'In Transit' }
// ]

// Then .length returns:

// 2

// In short, filter() is used to select only the records you need from a list.

// Props received by the DataMiningPage component.
// records = evacuation history records coming from Supabase/API/App.tsx.
type DataMiningPageProps = {
  records: EvacuationHistoryRecord[]
}

export function DataMiningPage({ records }: DataMiningPageProps) {
  // Stores the currently selected sitio filter.
  // Default is "All", meaning the page analyzes every evacuation record.
  const [selectedSitio, setSelectedSitio] = useState('All')

  // Builds the dropdown options for the sitio filter.
  // Example result: ["All", "Sitio 1", "Sitio 2", "Sitio 3"]
  // useMemo prevents recalculating this list unless records changes.
  const sitioOptions = useMemo(() => {
    return ['All', ...Array.from(new Set(records.map((record) => record.sitio)))]
  }, [records])

  // Filters the records based on the selected sitio.
  // If "All" is selected, it returns every record.
  // If a specific sitio is selected, it returns only records from that sitio.
  const filteredRecords = useMemo(() => {
    if (selectedSitio === 'All') {
      return records
    }

    return records.filter((record) => record.sitio === selectedSitio)
  }, [records, selectedSitio])

  // Creates the top summary cards shown on the Data Mining page.
  // These values are based only on the filtered records.
  const summary = useMemo(() => {
    // Total number of evacuation records being analyzed.
    const totalRecords = filteredRecords.length

    // Counts records marked as flood-zone related.
    // In your current data mapping, this usually means the resident has GPS coordinates.
    const floodZoneCases = filteredRecords.filter((record) => record.floodZone).length

    // Counts cases that still need follow-up.
    // These statuses are not fully completed yet.
    const unresolvedCases = filteredRecords.filter((record) =>
      ['Pending', 'Missing / Relocated', 'In Transit'].includes(record.status),
    ).length

    // Calculates the average response time in minutes.
    // If there are no records, it returns 0 to avoid dividing by zero.
    const averageResponseTime =
      totalRecords === 0
        ? 0
        : Math.round(
            filteredRecords.reduce((total, record) => total + record.responseMinutes, 0) /
              totalRecords,
          )

    return {
      totalRecords,
      floodZoneCases,
      unresolvedCases,
      averageResponseTime,
    }
  }, [filteredRecords])

  // Groups records by sitio.
  // This identifies which sitio has the highest number of evacuation records.
  const hotspotData = useMemo(() => {
    return countByField(filteredRecords, 'sitio').sort((a, b) => b.value - a.value)
  }, [filteredRecords])

  // Groups records by month.
  // This helps show which months have the most evacuation activity.
  const monthlyTrends = useMemo(() => {
    const monthOrder = ['June', 'July', 'August', 'September', 'October', 'November', 'December']

    return countByField(filteredRecords, 'month').sort(
      (a, b) => monthOrder.indexOf(a.label) - monthOrder.indexOf(b.label),
    )
  }, [filteredRecords])

  // Groups records by assistance or mobility constraint.
  // Example categories: Bedridden, Wheelchair, Visual, Walk Assist.
  const constraintPatterns = useMemo(() => {
    return countByField(filteredRecords, 'constraint').sort((a, b) => b.value - a.value)
  }, [filteredRecords])

  // Gets only missing or relocated cases.
  // These records are displayed in the ledger table at the bottom.
  const missingLedger = useMemo(() => {
    return filteredRecords.filter((record) => record.status === 'Missing / Relocated')
  }, [filteredRecords])

  // Gets the strongest results from each mining category.
  // Optional chaining is used because there may be no records.
  const topHotspot = hotspotData[0]
  const topConstraint = constraintPatterns[0]
  const peakMonth = [...monthlyTrends].sort((a, b) => b.value - a.value)[0]

  return (
    <section className="data-mining-page">
      {/* Page introduction and sitio filter */}
      <div className="panel mining-intro">
        <div>
          <h3>Post-Disaster Data Mining</h3>
          <p>
            Analyze evacuation history to identify vulnerable hotspots, seasonal trends,
            common assistance needs, and unresolved rescue cases.
          </p>
        </div>

        {/* Dropdown used to filter the analysis by sitio */}
        <select value={selectedSitio} onChange={(event) => setSelectedSitio(event.target.value)}>
          {sitioOptions.map((sitio) => (
            <option key={sitio} value={sitio}>
              {sitio}
            </option>
          ))}
        </select>
      </div>

      {/* Top data mining summary cards */}
      <section className="mining-summary-grid">
        <MiningCard
          label="Records Analyzed"
          value={summary.totalRecords}
          note="Filtered historical logs"
        />

        <MiningCard
          label="Flood-Zone Cases"
          value={summary.floodZoneCases}
          note="High-risk locations"
        />

        <MiningCard
          label="Unresolved Cases"
          value={summary.unresolvedCases}
          note="Needs follow-up"
        />

        {/* Average response time is currently hidden.
            Uncomment this card if you want to show response-time analytics again. */}
        {/* <MiningCard
          label="Avg. Response Time"
          value={`${summary.averageResponseTime} min`}
          note="Estimated field response"
        /> */}
      </section>

      {/* Main data mining panels */}
      <section className="mining-grid">
        <MiningBarPanel
          title="Geospatial Vulnerability Hotspots"
          description="Counts evacuation records by sitio to identify priority deployment zones."
          rows={hotspotData}
        />

        <MiningBarPanel
          title="Seasonal Evacuation Trends"
          description="Groups records by month to show when preparation is most needed."
          rows={monthlyTrends}
        />

        <MiningBarPanel
          title="Assistance Needs Pattern"
          description="Shows the most common resident constraints during rescue operations."
          rows={constraintPatterns}
        />

        {/* Automatically generated insights from the mined data */}
        <section className="panel insights-panel">
          <h3>Generated Insights</h3>

          <ul>
            <li>
              <strong>{topHotspot?.label ?? 'No hotspot'}</strong> has the highest number of
              logged evacuation records.
            </li>
            <li>
              <strong>{topConstraint?.label ?? 'No constraint'}</strong> is the most frequent
              assistance category.
            </li>
            <li>
              <strong>{peakMonth?.label ?? 'No trend'}</strong> is the peak month in the current
              historical records.
            </li>
            <li>
              Unresolved records should be prioritized for follow-up and field validation.
            </li>
          </ul>
        </section>
      </section>

      {/* Ledger table for missing or relocated residents */}
      <section className="panel">
        <div className="section-header">
          <h3>Missing / Relocated Persons Ledger</h3>
          <span>{missingLedger.length} record(s)</span>
        </div>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Resident</th>
                <th>Sitio</th>
                <th>Constraint</th>
                <th>Disaster Event</th>
                <th>Status</th>
              </tr>
            </thead>

            <tbody>
              {missingLedger.length === 0 ? (
                <tr>
                  <td colSpan={5}>No missing or relocated records for this filter.</td>
                </tr>
              ) : (
                missingLedger.map((record) => (
                  <tr key={record.id}>
                    <td>{record.residentName}</td>
                    <td>{record.sitio}</td>
                    <td>{record.constraint}</td>
                    <td>{record.disasterEvent}</td>
                    <td>{record.status}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  )
}

// Props for the small statistic card component.
type MiningCardProps = {
  label: string
  value: number | string
  note: string
}

// Reusable card for summary values such as total records and unresolved cases.
function MiningCard({ label, value, note }: MiningCardProps) {
  return (
    <article className="mining-card">
      <strong>{value}</strong>
      <span>{label}</span>
      <small>{note}</small>
    </article>
  )
}

// Props for the reusable bar chart panel.
type MiningBarPanelProps = {
  title: string
  description: string
  rows: { label: string; value: number; percent: number }[]
}

// Reusable panel that displays a simple horizontal bar chart.
// It is used for hotspots, monthly trends, and assistance needs.
function MiningBarPanel({ title, description, rows }: MiningBarPanelProps) {
  return (
    <section className="panel">
      <h3>{title}</h3>
      <p className="mining-description">{description}</p>

      <div className="mining-bar-list">
        {rows.map((row) => (
          <div className="mining-bar-row" key={row.label}>
            <div>
              <span>{row.label}</span>
              <strong>{row.value}</strong>
            </div>

            <div className="mining-track">
              {/* The bar width is based on the percentage calculated in countByField. */}
              <div className="mining-fill" style={{ width: `${row.percent}%` }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

// Counts how many records exist for a selected field.
// Example:
// countByField(records, 'sitio') counts records per sitio.
// countByField(records, 'month') counts records per month.
function countByField<T extends keyof EvacuationHistoryRecord>(
  records: EvacuationHistoryRecord[],
  field: T,
) {
  // Creates an object where each key is a field value and each value is its count.
  // Example: { "Sitio 1": 3, "Sitio 2": 1 }
  const counts = records.reduce<Record<string, number>>((totals, record) => {
    const key = String(record[field])
    totals[key] = (totals[key] ?? 0) + 1
    return totals
  }, {})

  // Gets the largest count.
  // Used so the biggest bar becomes 100%.
  // The fallback 1 prevents Math.max from breaking when records are empty.
  const maxValue = Math.max(...Object.values(counts), 1)

  // Converts the count object into an array that the bar panel can render.
  return Object.entries(counts).map(([label, value]) => ({
    label,
    value,
    percent: Math.round((value / maxValue) * 100),
  }))
}
