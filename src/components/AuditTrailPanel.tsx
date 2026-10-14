import { useMemo, useState } from 'react'
import { getOperationalTimeline } from '../api/auditTrailApi'
import {
  ALL_CATEGORIES, CATEGORY_LABELS, filterTimeline, formatPht, phtDayStart, timelineCsv, timelineFileName, timelineRows,
  TIMELINE_HEADERS,
} from '../utils/auditTrail'
import type { TimelineCategory, TimelineData } from '../utils/auditTrail'
import './AuditTrailPanel.css'

const PREVIEW_LIMIT = 200

function phtDate(offsetDays: number) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(Date.now() + offsetDays * 86_400_000))
}

async function loadFontBase64() {
  const { default: fontUrl } = await import('../assets/fonts/NotoSans-Regular.ttf?url')
  const response = await fetch(fontUrl)
  if (!response.ok) throw new Error('PDF font could not load. Try again, or download Excel/CSV.')
  const font = new Uint8Array(await response.arrayBuffer())
  let binary = ''
  for (let i = 0; i < font.length; i += 8192) binary += String.fromCharCode(...font.subarray(i, i + 8192))
  return btoa(binary)
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
  const [sitio, setSitio] = useState('all')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const sitioName = (id: number) => data?.sitios.find(s => s.sitio_id === id)?.sitio_name ?? `Sitio ${id}`
  const filtered = useMemo(() => data ? filterTimeline(data.events, {
    categories, search, sitioId: sitio === 'all' ? null : Number(sitio),
  }) : [], [data, categories, search, sitio])

  async function load() {
    if (busy) return
    setError(''); setNotice('')
    let from: Date, to: Date
    try {
      from = phtDayStart(fromDate)
      to = new Date(phtDayStart(toDate).getTime() + 86_400_000) // include the whole "to" day
    } catch { setError('Choose valid dates.'); return }
    if (from >= to) { setError('The start date must be on or before the end date.'); return }
    setBusy('Loading audit trail…')
    try { setData(await getOperationalTimeline(from, to)) }
    catch (e) { setData(null); setError(e instanceof Error ? e.message : 'Unable to load the audit trail.') }
    finally { setBusy('') }
  }

  function filterSummary() {
    const cats = categories.length === ALL_CATEGORIES.length ? 'All categories' : categories.map(c => CATEGORY_LABELS[c]).join(', ')
    const where = sitio === 'all' ? 'All sitios in scope' : sitio === '0' ? 'Facility-wide only' : sitioName(Number(sitio))
    return [cats, where, search.trim() ? `Search: "${search.trim()}"` : ''].filter(Boolean).join(' · ')
  }

  async function exportAs(format: 'csv' | 'xlsx' | 'pdf') {
    if (!data || busy) return
    setBusy(`Creating ${format.toUpperCase()}…`); setError(''); setNotice('')
    const meta = { scope: data.scope, from: data.from, to: data.to, generatedAt: data.generated_at, filters: filterSummary() }
    try {
      const name = timelineFileName(data.from, data.to, format)
      if (format === 'csv') {
        download(timelineCsv(filtered, sitioName, meta), 'text/csv;charset=utf-8', name)
      } else {
        const { createTimelineWorkbook, createTimelinePdf } = await import('../utils/auditTrailFiles')
        if (format === 'xlsx') {
          const book = await createTimelineWorkbook(filtered, sitioName, meta)
          download(new Uint8Array(await book.xlsx.writeBuffer()) as Uint8Array<ArrayBuffer>,
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', name)
        } else {
          const pdf = await createTimelinePdf(filtered, sitioName, meta, await loadFontBase64())
          download(new Uint8Array(pdf.output('arraybuffer')) as Uint8Array<ArrayBuffer>, 'application/pdf', name)
        }
      }
      setNotice(`${format.toUpperCase()} downloaded with ${filtered.length} event${filtered.length === 1 ? '' : 's'}.`)
    } catch (e) { setError(e instanceof Error ? e.message : 'Export failed. Try again.') }
    finally { setBusy('') }
  }

  const toggle = (c: TimelineCategory) =>
    setCategories(cur => cur.includes(c) ? cur.filter(x => x !== c) : ALL_CATEGORIES.filter(x => x === c || cur.includes(x)))
  const rows = timelineRows(filtered.slice(0, PREVIEW_LIMIT), sitioName)

  return <section className="panel rdana-panel audit-panel">
    <div className="section-header"><div><span className="panel-kicker">AUDIT TRAIL</span><h3>Evacuation Audit Trail & Operational Timestamp Log</h3></div><span>PDF · Excel · CSV</span></div>
    <p>One time-ordered log of evacuation status changes, record edits/deletions, evacuation center status and capacity changes, disaster declarations, missing-person actions, verification reviews and SOS alerts. Times are Philippine time (UTC+8).</p>
    <fieldset className="resident-edit-fields" disabled={Boolean(busy)}>
      <div className="audit-range">
        <label><span>From (PHT)</span><input type="date" value={fromDate} max={toDate} onChange={e => setFromDate(e.target.value)} /></label>
        <label><span>To (PHT, inclusive)</span><input type="date" value={toDate} min={fromDate} onChange={e => setToDate(e.target.value)} /></label>
        <button type="button" className="verify-button" onClick={() => void load()}>{data ? 'Reload log' : 'Load log'}</button>
      </div>
    </fieldset>
    {busy && <p role="status">{busy}</p>}
    {error && <p role="alert" className="dashboard-error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {data && <>
      <p className="audit-meta"><strong>Scope:</strong> {data.scope} · {formatPht(data.from)} to {formatPht(data.to)} PHT (end exclusive) · retrieved {formatPht(data.generated_at)} · {data.events.length} events loaded</p>
      <div className="audit-filters">
        <div className="audit-categories" role="group" aria-label="Categories">
          {ALL_CATEGORIES.map(c => <label key={c} className="audit-chip">
            <input type="checkbox" checked={categories.includes(c)} onChange={() => toggle(c)} />
            <span>{CATEGORY_LABELS[c]} ({data.events.filter(e => e.category === c).length})</span>
          </label>)}
        </div>
        <div className="audit-range">
          <label><span>Sitio</span><select value={sitio} onChange={e => setSitio(e.target.value)}>
            <option value="all">All in scope</option>
            {data.sitios.map(s => <option key={s.sitio_id} value={s.sitio_id}>{s.sitio_name}</option>)}
            <option value="0">Facility-wide only (centers)</option>
          </select></label>
          <label className="audit-search"><span>Search</span><input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Name, action, staff, details…" /></label>
        </div>
      </div>
      <div className="request-modal-actions">
        <button type="button" className="secondary-button" disabled={Boolean(busy) || !filtered.length} onClick={() => void exportAs('csv')}>Download CSV</button>
        <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => void exportAs('pdf')}>Download PDF</button>
        <button type="button" className="verify-button" disabled={Boolean(busy)} onClick={() => void exportAs('xlsx')}>Download Excel (.xlsx)</button>
      </div>
      <p className="audit-meta">{filtered.length} event{filtered.length === 1 ? '' : 's'} match the filters{filtered.length > PREVIEW_LIMIT ? ` — preview shows the first ${PREVIEW_LIMIT}; exports include all` : ''}.</p>
      {filtered.length > 0 && <div className="relief-table-wrap"><table className="relief-table audit-table">
        <thead><tr>{TIMELINE_HEADERS.slice(0, 10).map(h => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={`${filtered[i].ref_id}-${filtered[i].occurred_at}-${i}`}>{r.slice(0, 10).map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody>
      </table></div>}
      <p className="audit-meta">Evacuation record edits/deletions and “entered by” are captured from when the audit-trail migration was applied; earlier edits cannot be recovered. SOS alerts record only their creation time. “Not recorded” means the source stores no actor.</p>
    </>}
  </section>
}
