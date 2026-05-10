import { useMemo, useState } from 'react'
import type { EvacuationHistoryRecord } from '../types/dashboard'

type DataMiningPageProps = {
  records: EvacuationHistoryRecord[]
}

export function DataMiningPage({ records }: DataMiningPageProps) {
  // Filters the mining data by sitio.
  const [selectedSitio, setSelectedSitio] = useState('All')

  const sitioOptions = useMemo(() => {
    return ['All', ...Array.from(new Set(records.map((record) => record.sitio)))]
  }, [records])

  const filteredRecords = useMemo(() => {
    if (selectedSitio === 'All') {
      return records
    }

    return records.filter((record) => record.sitio === selectedSitio)
  }, [records, selectedSitio])

  // Summary values generated from the selected historical records.
  const summary = useMemo(() => {
    const totalRecords = filteredRecords.length
    const floodZoneCases = filteredRecords.filter((record) => record.floodZone).length
    const unresolvedCases = filteredRecords.filter((record) =>
      ['Pending', 'Missing / Relocated', 'In Transit'].includes(record.status),
    ).length

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

  const hotspotData = useMemo(() => {
    return countByField(filteredRecords, 'sitio').sort((a, b) => b.value - a.value)
  }, [filteredRecords])

  const monthlyTrends = useMemo(() => {
    const monthOrder = ['June', 'July', 'August', 'September', 'October', 'November', 'December']

    return countByField(filteredRecords, 'month').sort(
      (a, b) => monthOrder.indexOf(a.label) - monthOrder.indexOf(b.label),
    )
  }, [filteredRecords])

  const constraintPatterns = useMemo(() => {
    return countByField(filteredRecords, 'constraint').sort((a, b) => b.value - a.value)
  }, [filteredRecords])

  const missingLedger = useMemo(() => {
    return filteredRecords.filter((record) => record.status === 'Missing / Relocated')
  }, [filteredRecords])

  const topHotspot = hotspotData[0]
  const topConstraint = constraintPatterns[0]
  const peakMonth = [...monthlyTrends].sort((a, b) => b.value - a.value)[0]

  return (
    <section className="data-mining-page">
      <div className="panel mining-intro">
        <div>
          <h3>Post-Disaster Data Mining</h3>
          <p>
            Analyze evacuation history to identify vulnerable hotspots, seasonal trends,
            common assistance needs, and unresolved rescue cases.
          </p>
        </div>

        <select value={selectedSitio} onChange={(event) => setSelectedSitio(event.target.value)}>
          {sitioOptions.map((sitio) => (
            <option key={sitio} value={sitio}>
              {sitio}
            </option>
          ))}
        </select>
      </div>

      <section className="mining-summary-grid">
        <MiningCard label="Records Analyzed" value={summary.totalRecords} note="Filtered historical logs" />
        <MiningCard label="Flood-Zone Cases" value={summary.floodZoneCases} note="High-risk locations" />
        <MiningCard label="Unresolved Cases" value={summary.unresolvedCases} note="Needs follow-up" />
        <MiningCard
          label="Avg. Response Time"
          value={`${summary.averageResponseTime} min`}
          note="Estimated field response"
        />
      </section>

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

type MiningCardProps = {
  label: string
  value: number | string
  note: string
}

function MiningCard({ label, value, note }: MiningCardProps) {
  return (
    <article className="mining-card">
      <strong>{value}</strong>
      <span>{label}</span>
      <small>{note}</small>
    </article>
  )
}

type MiningBarPanelProps = {
  title: string
  description: string
  rows: { label: string; value: number; percent: number }[]
}

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
              <div className="mining-fill" style={{ width: `${row.percent}%` }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

// Counts how many records exist for a selected field.
function countByField<T extends keyof EvacuationHistoryRecord>(
  records: EvacuationHistoryRecord[],
  field: T,
) {
  const counts = records.reduce<Record<string, number>>((totals, record) => {
    const key = String(record[field])
    totals[key] = (totals[key] ?? 0) + 1
    return totals
  }, {})

  const maxValue = Math.max(...Object.values(counts), 1)

  return Object.entries(counts).map(([label, value]) => ({
    label,
    value,
    percent: Math.round((value / maxValue) * 100),
  }))
}
