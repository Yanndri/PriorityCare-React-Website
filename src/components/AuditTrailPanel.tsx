import { useEffect, useMemo, useState } from 'react'
import { useScopeBarangay } from '../lib/scope'
import { getOperationalTimeline } from '../api/auditTrailApi'
import {
  ALL_CATEGORIES, CATEGORY_LABELS, filterTimeline, formatPht, phtDayStart, timelineCsv, timelineFileName, timelineTableRows,
  TIMELINE_HEADERS,
} from '../utils/auditTrail'
import type { TimelineCategory, TimelineData } from '../utils/auditTrail'
import './AuditTrailPanel.css'

const PREVIEW_LIMIT = 200

function phtDate(offsetDays: number) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(Date.now() + offsetDays * 86_400_000))
}

function download(bytes: BlobPart, type: string, name: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type }))
  const link = document.createElement('a')
  link.href = url; link.download = name
  document.body.appendChild(link); link.click(); link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function AuditTrailPanel() {
  const [fromDate, setFromDate] = useState(() => phtDate(-6))
  const [toDate, setToDate] = useState(() => phtDate(0))
  const [data, setData] = useState<TimelineData | null>(null)
  const [categories, setCategories] = useState<TimelineCategory[]>(ALL_CATEGORIES)
  // Starts on the barangay chosen in the Scope selector.
  const scope = useScopeBarangay()
  const [barangay, setBarangay] = useState(scope != null ? String(scope) : 'all')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const barangayName = (id: number) => data?.barangays.find(s => s.barangay_id === id)?.barangay_name ?? `Barangay ${id}`
  const filtered = useMemo(() => data ? filterTimeline(data.events, {
    categories, search, barangayId: barangay === 'all' ? null : Number(barangay),
  }) : [], [data, categories, search, barangay])

  async function load() {
    if (busy) return
    setError(''); setNotice('')
    let from: Date, to: Date
    try {
      from = phtDayStart(fromDate)
      to = new Date(phtDayStart(toDate).getTime() + 86_400_000) // include the whole "to" day
    } catch { setError('Choose valid dates.'); return }
    if (from >= to) { setError('The start date must be on or before the end date.'); return }
    setBusy('Loading activity…')
    try { setData(await getOperationalTimeline(from, to)) }
    catch (e) { setData(null); setError(e instanceof Error ? e.message : 'Unable to load the audit trail.') }
    finally { setBusy('') }
  }

  // Show the last 7 days straight away, so the page is never blank.
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { void load() }, [])

  function filterSummary() {
    const cats = categories.length === ALL_CATEGORIES.length ? 'All categories' : categories.map(c => CATEGORY_LABELS[c]).join(', ')
    const where = barangay === 'all' ? 'All barangays in scope' : barangay === '0' ? 'Facility-wide only' : barangayName(Number(barangay))
    return [cats, where, search.trim() ? `Search: "${search.trim()}"` : ''].filter(Boolean).join(' · ')
  }

  // One export format: CSV (opens in Excel or Google Sheets).
  function exportCsv() {
    if (!data || busy) return
    setError(''); setNotice('')
    const meta = { scope: data.scope, from: data.from, to: data.to, generatedAt: data.generated_at, filters: filterSummary() }
    try {
      download(timelineCsv(filtered, barangayName, meta), 'text/csv;charset=utf-8', timelineFileName(data.from, data.to, 'csv'))
      setNotice(`CSV downloaded with ${filtered.length} event${filtered.length === 1 ? '' : 's'}.`)
    } catch (e) { setError(e instanceof Error ? e.message : 'Export failed. Try again.') }
  }

  const toggle = (c: TimelineCategory) =>
    setCategories(cur => cur.includes(c) ? cur.filter(x => x !== c) : ALL_CATEGORIES.filter(x => x === c || cur.includes(x)))
  const rows = timelineTableRows(filtered.slice(0, PREVIEW_LIMIT), barangayName)

  return <section className="panel rdana-panel audit-panel">
    <div className="section-header"><div><h3>Activity log</h3></div></div>
    <p>Everything staff and residents did, newest first: evacuation check-ins, record changes, evacuation center updates, disasters, missing person reports, ID reviews and SOS alerts. Times are Philippine time.</p>
    <fieldset className="resident-edit-fields" disabled={Boolean(busy)}>
      <div className="audit-range">
        <label><span>From (PHT)</span><input type="date" value={fromDate} max={toDate} onChange={e => setFromDate(e.target.value)} /></label>
        <label><span>To (PHT, inclusive)</span><input type="date" value={toDate} min={fromDate} onChange={e => setToDate(e.target.value)} /></label>
        <button type="button" className="verify-button" onClick={() => void load()}>Show these dates</button>
      </div>
    </fieldset>
    {busy && <p role="status">{busy}</p>}
    {error && <p role="alert" className="dashboard-error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {data && <>
      <p className="audit-meta"><strong>{data.scope}</strong> · {fromDate} to {toDate} · {data.events.length} event{data.events.length === 1 ? '' : 's'} · updated {formatPht(data.generated_at)}</p>
      <div className="audit-filters">
        <div className="audit-categories" role="group" aria-label="Categories">
          {ALL_CATEGORIES.map(c => <label key={c} className="audit-chip">
            <input type="checkbox" checked={categories.includes(c)} onChange={() => toggle(c)} />
            <span>{CATEGORY_LABELS[c]} ({data.events.filter(e => e.category === c).length})</span>
          </label>)}
        </div>
        <div className="audit-range">
          <label><span>Barangay</span><select value={barangay} onChange={e => setBarangay(e.target.value)}>
            <option value="all">All in scope</option>
            {data.barangays.map(s => <option key={s.barangay_id} value={s.barangay_id}>{s.barangay_name}</option>)}
            <option value="0">Facility-wide only (centers)</option>
          </select></label>
          <label className="audit-search"><span>Search</span><input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Name, action, staff, details…" /></label>
        </div>
      </div>
      <div className="request-modal-actions">
        <button type="button" className="verify-button" disabled={Boolean(busy) || !filtered.length} onClick={exportCsv}>Download CSV</button>
      </div>
      <p className="audit-meta">{filtered.length} event{filtered.length === 1 ? '' : 's'} match the filters{filtered.length > PREVIEW_LIMIT ? ` — preview shows the first ${PREVIEW_LIMIT}; the CSV includes all` : ''}.</p>
      {filtered.length > 0 && <div className="relief-table-wrap"><table className="relief-table audit-table">
        <thead><tr>{TIMELINE_HEADERS.slice(0, 10).map(h => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={`${filtered[i].ref_id}-${filtered[i].occurred_at}-${i}`}>{r.slice(0, 10).map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody>
      </table></div>}
      <p className="audit-meta">Edits and deletions are logged from the day this log was switched on. SOS alerts show only the time they were sent. “Not recorded” means the system did not save who did it.</p>
    </>}
  </section>
}
