import { useEffect, useMemo, useState } from 'react'
import { fetchOperationalTimeline } from '../../api/analyticsApi'
import { createTableWorkbook, CSV_TYPE, downloadFile, fileStamp, XLSX_TYPE } from '../../utils/analyticsExport'
import {
  categoryCoverage, countByCategory, manilaDate, manilaDateRange, manilaTimestamp, MAX_RANGE_DAYS,
  timelineCategories, timelineHeaders, timelineRows, toCsv,
  type TimelineCategory, type TimelineData,
} from '../../utils/auditTrail'
import { AnalyticsBars } from './AnalyticsWidgets'

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: TimelineData }

const PREVIEW_LIMIT = 200
const allCategories = Object.keys(timelineCategories) as TimelineCategory[]
const evacuationCategories: TimelineCategory[] = ['evacuation', 'evacuation_change', 'facility']

export function AuditTrailPanel() {
  const [fromDate, setFromDate] = useState(() => manilaDate(-6))
  const [toDate, setToDate] = useState(() => manilaDate(0))
  const [request, setRequest] = useState(() => ({ from: manilaDate(-6), to: manilaDate(0), key: 0 }))
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [rangeError, setRangeError] = useState('')
  const [selected, setSelected] = useState<TimelineCategory[]>(allCategories)
  const [busy, setBusy] = useState('')
  const [exportError, setExportError] = useState('')

  useEffect(() => {
    let active = true
    Promise.resolve()
      .then(() => manilaDateRange(request.from, request.to))
      .then((range) => fetchOperationalTimeline(range.from, range.to))
      .then(
        (data) => { if (active) setState({ status: 'ready', data }) },
        (error: unknown) => {
          if (active) setState({ status: 'error', message: error instanceof Error ? error.message : 'Unable to load the logs.' })
        },
      )
    return () => { active = false }
  }, [request])

  function load() {
    try {
      manilaDateRange(fromDate, toDate)
    } catch (error) {
      setRangeError(error instanceof Error ? error.message : 'Invalid date range.')
      return
    }
    setRangeError('')
    setState({ status: 'loading' })
    setRequest((current) => ({ from: fromDate, to: toDate, key: current.key + 1 }))
  }

  const data = state.status === 'ready' ? state.data : null
  const filtered = useMemo(
    () => (data ? data.events.filter((event) => selected.includes(event.category)) : []),
    [data, selected],
  )
  const counts = useMemo(() => countByCategory(data?.events ?? []), [data])
  const rangeLabel = `${request.from} to ${request.to} (Asia/Manila, inclusive)`

  function toggle(category: TimelineCategory) {
    setSelected((current) => (current.includes(category) ? current.filter((item) => item !== category) : [...current, category]))
  }

  async function exportFile(format: 'xlsx' | 'csv') {
    if (!data || busy) return
    setBusy(format === 'xlsx' ? 'Creating Excel file…' : 'Creating CSV…')
    setExportError('')
    try {
      const rows = timelineRows(data, filtered)
      const stamp = fileStamp(data.generated_at)
      if (format === 'csv') {
        downloadFile(toCsv(timelineHeaders, rows), `prioritycare-audit-trail-${stamp}.csv`, CSV_TYPE)
      } else {
        const coverage = allCategories.map((category) => [
          timelineCategories[category],
          selected.includes(category) ? 'Included' : 'Excluded by filter',
          counts[category],
          categoryCoverage[category],
        ])
        const bytes = await createTableWorkbook('Evacuation Audit Trail & Operational Timestamp Log', [
          ['Scope', data.scope],
          ['Range', rangeLabel],
          ['Range (UTC)', `${data.from} to ${data.to} (end exclusive)`],
          ['Generated (UTC)', new Date(data.generated_at).toISOString()],
          ['Note', 'A count of 0 means the log was retrieved and recorded no activity of that type in the range.'],
          ['Privacy', 'Contains personal data. Handle according to the data privacy policy.'],
        ], [
          { name: 'Timeline', headers: timelineHeaders, rows },
          { name: 'Log coverage', headers: ['Log source', 'Export', 'Entries in range', 'What is recorded'], rows: coverage },
        ])
        downloadFile(bytes as Uint8Array<ArrayBuffer>, `prioritycare-audit-trail-${stamp}.xlsx`, XLSX_TYPE)
      }
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Export failed. Try again.')
    } finally {
      setBusy('')
    }
  }

  return (
    <section className="panel analytics-panel">
      <div className="section-header">
        <div>
          <span className="panel-kicker">AUDIT TRAILS & TIMESTAMP LOGS</span>
          <h3>Evacuation Audit Trail & Operational Log</h3>
        </div>
      </div>
      <p className="mining-description">
        Recorded evacuation, facility, disaster-event, missing-person, verification, and SOS activity in your scope,
        with exact stored timestamps. Exports list times in UTC (ISO 8601) and Asia/Manila. Ranges of up to {MAX_RANGE_DAYS} days.
      </p>

      <div className="analytics-toolbar">
        <label><span>From</span><input type="date" value={fromDate} max={toDate} onChange={(event) => setFromDate(event.target.value)} /></label>
        <label><span>To</span><input type="date" value={toDate} min={fromDate} onChange={(event) => setToDate(event.target.value)} /></label>
        <button type="button" className="verify-button" onClick={load} disabled={state.status === 'loading'}>
          {state.status === 'loading' ? 'Loading…' : 'Load logs'}
        </button>
        <button type="button" className="secondary-button" onClick={() => setSelected(evacuationCategories)}>Evacuation only</button>
        <button type="button" className="secondary-button" onClick={() => setSelected(allCategories)}>All categories</button>
      </div>
      {rangeError && <p role="alert" className="dashboard-error">{rangeError}</p>}

      <fieldset className="analytics-categories">
        <legend>Log categories</legend>
        {allCategories.map((category) => (
          <label key={category}>
            <input type="checkbox" checked={selected.includes(category)} onChange={() => toggle(category)} />
            <span>{timelineCategories[category]}{data ? ` (${counts[category]})` : ''}</span>
          </label>
        ))}
      </fieldset>

      {state.status === 'loading' && <p role="status">Loading logs…</p>}
      {state.status === 'error' && (
        <p role="alert" className="dashboard-error">
          Logs unavailable: {state.message} This is not the same as “no activity” — nothing can be concluded for this range.
        </p>
      )}

      {data && (
        <>
          <p role="status">
            {data.events.length === 0
              ? `Logs retrieved successfully: no activity was recorded in ${data.scope} for ${rangeLabel}.`
              : `${data.events.length} recorded entr${data.events.length === 1 ? 'y' : 'ies'} in ${data.scope} for ${rangeLabel}; ${filtered.length} in the selected categories.`}
          </p>
          <div className="analytics-two-col">
            <section>
              <h4>Entries by category</h4>
              <AnalyticsBars rows={allCategories.map((category) => ({ label: timelineCategories[category], value: counts[category] }))} empty="No activity recorded in this range." />
            </section>
            <section>
              <h4>What each log records</h4>
              <ul className="analytics-list">
                {allCategories.map((category) => <li key={category}><strong>{timelineCategories[category]}:</strong> {categoryCoverage[category]}</li>)}
              </ul>
            </section>
          </div>

          <div className="analytics-toolbar">
            <div className="analytics-actions">
              <button type="button" className="secondary-button" disabled={Boolean(busy) || !selected.length} onClick={() => void exportFile('csv')}>Export CSV</button>
              <button type="button" className="verify-button" disabled={Boolean(busy) || !selected.length} onClick={() => void exportFile('xlsx')}>Export Excel</button>
            </div>
          </div>
          {busy && <p role="status">{busy}</p>}
          {exportError && <p role="alert" className="dashboard-error">{exportError}</p>}

          <div className="relief-table-wrap">
            <table className="relief-table analytics-table">
              <thead><tr><th>Occurred (Asia/Manila)</th><th>Category</th><th>Action</th><th>Subject</th><th>From → To</th><th>Actor</th><th>Details</th></tr></thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={7}>{data.events.length === 0 ? 'No activity was recorded in this range.' : 'No entries in the selected categories.'}</td></tr>
                ) : filtered.slice(0, PREVIEW_LIMIT).map((event) => (
                  <tr key={`${event.category}-${event.ref_id}-${event.occurred_at}-${event.action}`}>
                    <td><time dateTime={event.occurred_at}>{manilaTimestamp(event.occurred_at)}</time></td>
                    <td>{timelineCategories[event.category] ?? event.category}</td>
                    <td>{event.action}</td>
                    <td>{event.subject ?? '—'}</td>
                    <td>{event.from_value || event.to_value ? `${event.from_value ?? '—'} → ${event.to_value ?? '—'}` : '—'}</td>
                    <td>{event.actor_name ?? 'Not recorded'}{event.actor_role ? ` (${event.actor_role})` : ''}</td>
                    <td>{event.details ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length > PREVIEW_LIMIT && <p className="mining-description">Showing the first {PREVIEW_LIMIT} of {filtered.length} entries. Exports include all {filtered.length}.</p>}
        </>
      )}
    </section>
  )
}
