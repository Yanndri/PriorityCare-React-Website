import { useEffect, useMemo, useState } from 'react'
import { fetchRescueReconciliation } from '../../api/analyticsApi'
import { toCsv } from '../../utils/auditTrail'
import { createTableWorkbook, CSV_TYPE, downloadFile, fileStamp, XLSX_TYPE } from '../../utils/analyticsExport'
import {
  manilaTime, outcomeLabels, reconcile, reconciliationTables, residentName,
  type Outcome, type ReconciliationData,
} from '../../utils/reconciliation'
import { AnalyticsBars, AnalyticsCard } from './AnalyticsWidgets'

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: ReconciliationData }

const outcomeOrder: Outcome[] = ['ready_to_close', 'possible_match', 'unresolved', 'closed_matched', 'closed_note', 'withdrawn']

export function RescueReconciliationPanel() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)
  const [outcome, setOutcome] = useState<'all' | 'open' | Outcome>('open')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState('')
  const [exportError, setExportError] = useState('')

  useEffect(() => {
    let active = true
    fetchRescueReconciliation().then(
      (data) => { if (active) setState({ status: 'ready', data }) },
      (error: unknown) => {
        if (active) setState({ status: 'error', message: error instanceof Error ? error.message : 'Unable to load the reconciliation.' })
      },
    )
    return () => { active = false }
  }, [reloadKey])

  const data = state.status === 'ready' ? state.data : null
  const result = useMemo(() => (data ? reconcile(data) : null), [data])

  const visible = useMemo(() => {
    if (!result) return []
    const needle = search.trim().toLowerCase()
    return result.rows.filter((row) =>
      (outcome === 'all' || (outcome === 'open' ? row.report.status === 'missing' : row.outcome === outcome))
      && (!needle || row.report.full_name.toLowerCase().includes(needle)),
    )
  }, [result, outcome, search])

  function refresh() {
    setState({ status: 'loading' })
    setReloadKey((key) => key + 1)
  }

  async function exportFile(format: 'xlsx' | 'csv') {
    if (!data || !result || busy) return
    setBusy(format === 'xlsx' ? 'Creating Excel file…' : 'Creating CSV…')
    setExportError('')
    try {
      const tables = reconciliationTables(data, result)
      const stamp = fileStamp(data.generated_at)
      if (format === 'csv') {
        downloadFile(toCsv(tables[0].headers, tables[0].rows), `prioritycare-rescue-reconciliation-${stamp}.csv`, CSV_TYPE)
      } else {
        const bytes = await createTableWorkbook('Rescue Reconciliation', [
          ['Scope', data.barangays.map((barangay) => barangay.barangay_name).join(', ') || 'No barangay in scope'],
          ['Generated (Asia/Manila)', manilaTime(data.generated_at)],
          ['Matching rule', 'Matches use recorded resident IDs only. Name agreement is never a match; corroborated candidates require in-person verification.'],
          ['Privacy', 'Contains personal data. Reporter contact details are excluded.'],
        ], tables)
        downloadFile(bytes as Uint8Array<ArrayBuffer>, `prioritycare-rescue-reconciliation-${stamp}.xlsx`, XLSX_TYPE)
      }
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Export failed. Try again.')
    } finally {
      setBusy('')
    }
  }

  const statusBreakdown = useMemo(() => {
    if (!data) return []
    const labels: [string, string][] = [['safely_evacuated', 'Safely evacuated'], ['in_transit', 'In transit'], ['pending', 'Pending'], ['failed', 'Failed']]
    return [
      ...labels.map(([key, label]) => ({ label, value: data.residents.filter((resident) => resident.latest_status === key).length })),
      { label: 'No evacuation record', value: data.residents.filter((resident) => !resident.latest_status).length },
    ]
  }, [data])

  return (
    <section className="panel analytics-panel">
      <div className="section-header">
        <div>
          <span className="panel-kicker">MASTER RESCUED DIRECTORY × MISSING PERSONS MANIFEST</span>
          <h3>Rescue Reconciliation</h3>
        </div>
        <button type="button" className="secondary-button" onClick={refresh} disabled={state.status === 'loading'}>
          {state.status === 'loading' ? 'Loading…' : 'Refresh'}
        </button>
      </div>
      <p className="mining-description">
        The Master Rescued Directory lists registered residents whose latest evacuation record is
        <strong> safely evacuated</strong>. Reports match it only through a recorded resident ID.
        Reports without an ID link are checked for registered residents whose name agrees exactly and whose recorded
        sex and age (±2 years) also agree; these are flagged for verification and never treated as matches.
      </p>

      {state.status === 'loading' && <p role="status">Loading the manifest and rescued directory…</p>}
      {state.status === 'error' && (
        <p role="alert" className="dashboard-error">Reconciliation unavailable: {state.message}</p>
      )}

      {data && result && (
        <>
          <section className="mining-summary-grid">
            <AnalyticsCard label="Open missing-person reports" value={result.counts.open} note={`${data.reports.length} report(s) in the manifest`} />
            <AnalyticsCard label="Linked & rescued — close after verifying" value={result.counts.ready_to_close} note="Resident ID in rescued directory" />
            <AnalyticsCard label="Possible matches" value={result.counts.possible_match} note="Corroborated; needs verification" />
            <AnalyticsCard label="Unresolved" value={result.counts.unresolved} note="No rescued-directory evidence" />
            <AnalyticsCard label="Reports with discrepancies" value={result.counts.discrepancies} note="See table" />
            <AnalyticsCard label="Master Rescued Directory" value={result.rescuedDirectory.length} note={`of ${result.counts.residentsInScope} registered resident(s)`} />
          </section>

          <div className="analytics-two-col">
            <section>
              <h4>Manifest outcomes</h4>
              <AnalyticsBars
                rows={outcomeOrder.map((key) => ({ label: outcomeLabels[key], value: result.counts[key] }))}
                empty="No missing-person reports are recorded in your scope."
              />
            </section>
            <section>
              <h4>Registered residents by latest evacuation record</h4>
              <AnalyticsBars rows={statusBreakdown} empty="No registered residents in your scope." />
            </section>
          </div>

          <div className="analytics-toolbar">
            <label>
              <span>Show</span>
              <select value={outcome} onChange={(event) => setOutcome(event.target.value as typeof outcome)}>
                <option value="open">Open reports</option>
                <option value="all">All reports</option>
                {outcomeOrder.map((key) => <option key={key} value={key}>{outcomeLabels[key]}</option>)}
              </select>
            </label>
            <label>
              <span>Search reported name</span>
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name" />
            </label>
            <div className="analytics-actions">
              <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => void exportFile('csv')}>Export CSV</button>
              <button type="button" className="verify-button" disabled={Boolean(busy)} onClick={() => void exportFile('xlsx')}>Export Excel</button>
            </div>
          </div>
          {busy && <p role="status">{busy}</p>}
          {exportError && <p role="alert" className="dashboard-error">{exportError}</p>}

          <div className="relief-table-wrap">
            <table className="relief-table analytics-table">
              <thead>
                <tr>
                  <th>Reported name</th>
                  <th>Reported</th>
                  <th>Outcome</th>
                  <th>Directory evidence</th>
                  <th>Discrepancies</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr><td colSpan={5}>{data.reports.length === 0 ? 'No missing-person reports are recorded in your scope.' : 'No reports match this filter.'}</td></tr>
                ) : visible.map((row) => (
                  <tr key={row.report.report_id}>
                    <td>
                      <strong>{row.report.full_name}</strong>
                      <small className="analytics-sub">{[row.report.sex, row.report.approx_age !== null ? `~${row.report.approx_age} yrs` : ''].filter(Boolean).join(', ') || 'Sex/age not recorded'}</small>
                    </td>
                    <td>{manilaTime(row.report.reported_at)}</td>
                    <td><span className={`analytics-pill outcome-${row.outcome}`}>{outcomeLabels[row.outcome]}</span></td>
                    <td>
                      {row.evidence}
                      {row.candidates.length > 0 && (
                        <ul className="analytics-list">
                          {row.candidates.map((candidate) => (
                            <li key={candidate.resident.uid}>
                              {residentName(candidate.resident)} — {candidate.evidence}; {candidate.rescued ? `rescued${candidate.resident.center_name ? ` (${candidate.resident.center_name})` : ''}` : `latest record: ${candidate.resident.latest_status ?? 'none'}`}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td>{row.discrepancies.length ? <ul className="analytics-list">{row.discrepancies.map((item) => <li key={item}>{item}</li>)}</ul> : 'None'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <details className="relief-facility">
            <summary>Master Rescued Directory ({result.rescuedDirectory.length})</summary>
            <div className="relief-table-wrap">
              <table className="relief-table analytics-table">
                <thead><tr><th>Resident</th><th>Evacuation center</th><th>Evacuated at</th><th>Record logged at</th></tr></thead>
                <tbody>
                  {result.rescuedDirectory.length === 0 ? (
                    <tr><td colSpan={4}>No resident in your scope currently has a safely-evacuated latest record.</td></tr>
                  ) : result.rescuedDirectory.map((resident) => (
                    <tr key={resident.uid}>
                      <td>{residentName(resident)}</td>
                      <td>{resident.center_name ?? 'Not recorded'}</td>
                      <td>{manilaTime(resident.evacuated_at)}</td>
                      <td>{manilaTime(resident.latest_logged_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <p className="mining-description">Generated {manilaTime(data.generated_at)} (Asia/Manila). This view is read-only; it does not close, link, or edit reports.</p>
        </>
      )}
    </section>
  )
}
