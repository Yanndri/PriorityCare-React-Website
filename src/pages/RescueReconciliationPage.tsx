import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  fileMissingPersonReport, getRescueReconciliation, markMissingPersonFound, withdrawMissingPersonReport,
} from '../api/missingPersonsApi'
import {
  ageOn, fullName, matchLabels, reconcile, reconciliationCsv, statusLabels,
} from '../utils/rescueReconciliation'
import type { ReconciledReport, ReconciliationData } from '../utils/rescueReconciliation'
import './RescueReconciliationPage.css'

const formatTime = (value: string | null) => value
  ? new Date(value).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })
  : '—'

const emptyForm = {
  barangay: '', event: '', resident: '', name: '', sex: '', age: '', where: '', when: '',
  reporter: '', contact: '', notes: '',
}

type Closing = { reportId: string; mode: 'elsewhere' | 'withdraw' } | null

export function RescueReconciliationPage() {
  const [data, setData] = useState<ReconciliationData | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [closing, setClosing] = useState<Closing>(null)
  const [closingText, setClosingText] = useState('')
  const [directorySearch, setDirectorySearch] = useState('')

  async function load() {
    setLoading(true); setError('')
    try { setData(await getRescueReconciliation()) }
    catch (e) { setData(null); setError(e instanceof Error ? e.message : 'Unable to load the manifest.') }
    finally { setLoading(false) }
  }
  useEffect(() => {
    let cancelled = false
    getRescueReconciliation().then(d => { if (!cancelled) setData(d) })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Unable to load the manifest.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const result = useMemo(() => data ? reconcile(data) : null, [data])
  const barangayName = (id: number) => data?.barangays.find(s => s.barangay_id === id)?.barangay_name ?? `Barangay ${id}`
  const formBarangay = Number(form.barangay || data?.barangays[0]?.barangay_id || 0)
  const barangayResidents = (data?.residents ?? []).filter(r => r.barangay_id === formBarangay)
  const barangayEvents = (data?.events ?? []).filter(e => e.barangay_id === formBarangay && e.status === 'active')
  const set = (field: keyof typeof emptyForm) => (e: { target: { value: string } }) =>
    setForm(f => ({ ...f, [field]: e.target.value }))

  function pickResident(uid: string) {
    const r = data?.residents.find(x => x.uid === uid)
    setForm(f => r ? {
      ...f, resident: uid, name: fullName(r),
      sex: r.sex === 'male' || r.sex === 'female' ? r.sex : '',
      age: String(ageOn(r.birthdate, new Date()) ?? ''),
    } : { ...f, resident: '' })
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setNotice('')
    const age = form.age.trim() ? Number(form.age) : null
    if (age !== null && (!Number.isInteger(age) || age < 0 || age > 130)) { setError('Enter an age from 0 to 130, or leave it blank.'); return }
    let lastSeenAt: string | null = null
    if (form.when) {
      const t = new Date(`${form.when}:00+08:00`)
      if (!Number.isFinite(t.getTime()) || t.getTime() > Date.now()) { setError('Last-seen time cannot be in the future (Philippine time).'); return }
      lastSeenAt = t.toISOString()
    }
    setBusy(true)
    try {
      await fileMissingPersonReport({
        barangayId: formBarangay, eventId: form.event || null, residentUid: form.resident || null,
        fullName: form.name, sex: form.sex === 'male' || form.sex === 'female' ? form.sex : null, approxAge: age,
        lastSeenLocation: form.where, lastSeenAt, reporterName: form.reporter, reporterContact: form.contact, notes: form.notes,
      })
      setForm({ ...emptyForm, barangay: form.barangay })
      setNotice('Missing-person report added to the manifest.'); await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to file the report.') }
    finally { setBusy(false) }
  }

  async function confirmMatch(o: ReconciledReport, residentUid: string) {
    const r = data?.residents.find(x => x.uid === residentUid)
    if (!r || !window.confirm(`Confirm that "${o.report.full_name}" is ${fullName(r)}, safely evacuated at ${r.center_name ?? 'an evacuation center'}? This closes the report as found.`)) return
    setBusy(true); setError(''); setNotice('')
    try {
      await markMissingPersonFound(o.report.report_id, residentUid, '')
      setNotice(`${o.report.full_name} reconciled as found.`); await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to confirm the match.') }
    finally { setBusy(false) }
  }

  async function finishClosing(event: FormEvent) {
    event.preventDefault()
    if (!closing) return
    setBusy(true); setError(''); setNotice('')
    try {
      if (closing.mode === 'elsewhere') await markMissingPersonFound(closing.reportId, null, closingText)
      else await withdrawMissingPersonReport(closing.reportId, closingText)
      setNotice(closing.mode === 'elsewhere' ? 'Report closed as found.' : 'Report withdrawn. Its history is retained.')
      setClosing(null); setClosingText(''); await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to close the report.') }
    finally { setBusy(false) }
  }

  function exportCsv() {
    if (!result) return
    const blob = new Blob([reconciliationCsv(result, barangayName)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `rescue-reconciliation-${new Date().toISOString().slice(0, 10)}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const directory = (result?.rescued ?? []).filter(r =>
    !directorySearch.trim() || `${fullName(r)} ${r.center_name ?? ''}`.toLowerCase().includes(directorySearch.trim().toLowerCase()))
  const s = result?.summary

  return <div className="reconcile-page">
    <section className="panel reconcile-intro">
      <div className="reconcile-header">
        <div>
          <h3>Rescued directory vs. missing persons manifest</h3>
          <p>Each open missing-person report is compared with the Master Rescued Directory (residents whose latest evacuation record is <em>safely evacuated</em>). Matches are suggestions only — an administrator must confirm each one.</p>
          {data && <p className="reconcile-muted">Snapshot: {formatTime(data.generated_at)} (Philippine time)</p>}
        </div>
        <div className="reconcile-actions">
          <button type="button" className="secondary-button" disabled={loading || busy} onClick={() => { void load() }}>Refresh</button>
          <button type="button" className="secondary-button" disabled={!result} onClick={exportCsv}>Export CSV</button>
        </div>
      </div>
      {s && <div className="reconcile-stats">
        <article><span>Rescued directory</span><strong>{s.rescued}</strong></article>
        <article><span>Open missing reports</span><strong>{s.openReports}</strong></article>
        <article className="tone-good"><span>Confirmed rescued — close</span><strong>{s.linkedRescued}</strong></article>
        <article className="tone-warn"><span>Probable / possible matches</span><strong>{s.probable + s.possible}</strong></article>
        <article className="tone-bad"><span>Still missing</span><strong>{s.noMatch}</strong></article>
        <article className="tone-bad"><span>Unaccounted, not reported</span><strong>{s.unaccounted}</strong></article>
        <article><span>Found / withdrawn</span><strong>{s.found} / {s.withdrawn}</strong></article>
      </div>}
    </section>

    {error && <p role="alert" className="reconcile-error">{error}</p>}
    {notice && <p role="status" className="reconcile-notice">{notice}</p>}
    {loading && <p role="status">Loading manifest and rescued directory…</p>}

    <section className="panel">
      <h3>Reconciliation — open manifest</h3>
      {result && !result.open.length && <p>No open missing-person reports in your scope.</p>}
      {result?.open.map(o => <article key={o.report.report_id} className="reconcile-card">
        <div className="reconcile-card-head">
          <h4>{o.report.full_name}</h4>
          <span className={`reconcile-badge ${o.classification}`}>{matchLabels[o.classification]}</span>
        </div>
        <p className="reconcile-muted">
          {barangayName(o.report.barangay_id)} · {o.report.sex ?? 'sex unknown'} · {o.report.approx_age !== null ? `~${o.report.approx_age} yrs` : 'age unknown'}
          {o.report.last_seen_location && ` · Last seen: ${o.report.last_seen_location}`}
          {o.report.last_seen_at && ` (${formatTime(o.report.last_seen_at)})`}
        </p>
        <p className="reconcile-muted">Reported {formatTime(o.report.reported_at)} by {o.report.reporter_name}{o.report.reporter_contact && ` (${o.report.reporter_contact})`}
          {o.report.event_id && ` · Event: ${data?.events.find(e => e.event_id === o.report.event_id)?.name ?? 'linked event'}`}</p>
        {o.report.notes && <p className="reconcile-notes">{o.report.notes}</p>}
        {o.linkedResident && o.classification !== 'linked-rescued' && <p className="reconcile-muted">
          Linked registered resident — latest evacuation status: <strong>{o.linkedResident.latest_status ? statusLabels[o.linkedResident.latest_status] : 'no record'}</strong>
        </p>}
        {o.candidates.length > 0 && <table className="reconcile-table">
          <thead><tr><th>Rescued directory match</th><th>Score</th><th>Evidence</th><th>Evacuation center</th><th /></tr></thead>
          <tbody>{o.candidates.map(c => <tr key={c.resident.uid}>
            <td>{fullName(c.resident)}</td>
            <td>{c.score}</td>
            <td>{c.reasons.join(' · ')}</td>
            <td>{c.resident.center_name ?? '—'}<br /><small>{formatTime(c.resident.evacuated_at ?? c.resident.latest_logged_at)}</small></td>
            <td><button type="button" className="primary-button" disabled={busy} onClick={() => { void confirmMatch(o, c.resident.uid) }}>Confirm match</button></td>
          </tr>)}</tbody>
        </table>}
        {closing?.reportId === o.report.report_id
          ? <form onSubmit={finishClosing} className="reconcile-close-form">
            <label>{closing.mode === 'elsewhere' ? 'Where / how was the person found?' : 'Reason for withdrawal (duplicate, false report…)'}
              <textarea required maxLength={1000} value={closingText} onChange={e => setClosingText(e.target.value)} /></label>
            <button className="primary-button" disabled={busy || !closingText.trim()}>{closing.mode === 'elsewhere' ? 'Close as found' : 'Withdraw report'}</button>
            <button type="button" className="secondary-button" disabled={busy} onClick={() => setClosing(null)}>Cancel</button>
          </form>
          : <div className="reconcile-card-actions">
            <button type="button" className="secondary-button" disabled={busy} onClick={() => { setClosing({ reportId: o.report.report_id, mode: 'elsewhere' }); setClosingText('') }}>Found outside directory…</button>
            <button type="button" className="secondary-button" disabled={busy} onClick={() => { setClosing({ reportId: o.report.report_id, mode: 'withdraw' }); setClosingText('') }}>Withdraw…</button>
          </div>}
      </article>)}
    </section>

    <section className="panel">
      <h3>File a missing-person report</h3>
      <form onSubmit={submit}>
        <fieldset className="reconcile-form" disabled={!data || busy || loading || !data.barangays.length}>
          <label>Barangay<select value={formBarangay || ''} onChange={e => setForm(f => ({ ...f, barangay: e.target.value, resident: '', event: '' }))}>
            {data?.barangays.map(si => <option key={si.barangay_id} value={si.barangay_id}>{si.barangay_name}</option>)}</select></label>
          <label>Active disaster event (optional)<select value={form.event} onChange={set('event')}>
            <option value="">None</option>{barangayEvents.map(e => <option key={e.event_id} value={e.event_id}>{e.name}</option>)}</select></label>
          <label className="reconcile-wide">Registered resident (optional — fills the details below)
            <select value={form.resident} onChange={e => pickResident(e.target.value)}>
              <option value="">Not registered / unknown</option>
              {barangayResidents.map(r => <option key={r.uid} value={r.uid}>{fullName(r)}{r.latest_status ? ` — ${statusLabels[r.latest_status]}` : ''}</option>)}
            </select></label>
          <label>Full name<input required maxLength={200} value={form.name} onChange={set('name')} /></label>
          <label>Sex<select value={form.sex} onChange={set('sex')}><option value="">Unknown</option><option value="male">Male</option><option value="female">Female</option></select></label>
          <label>Approximate age<input type="number" min={0} max={130} step={1} value={form.age} onChange={set('age')} /></label>
          <label>Last seen (Philippine time, optional)<input type="datetime-local" value={form.when} onChange={set('when')} /></label>
          <label className="reconcile-wide">Last-seen location<input maxLength={500} value={form.where} onChange={set('where')} /></label>
          <label>Reported by<input required maxLength={200} value={form.reporter} onChange={set('reporter')} /></label>
          <label>Reporter contact<input maxLength={50} value={form.contact} onChange={set('contact')} /></label>
          <label className="reconcile-wide">Description / notes<textarea rows={3} maxLength={2000} value={form.notes} onChange={set('notes')} /></label>
          <button className="primary-button" type="submit">{busy ? 'Saving…' : 'Add to manifest'}</button>
        </fieldset>
      </form>
    </section>

    {result && result.unaccounted.length > 0 && <section className="panel">
      <h3>Unaccounted registered residents</h3>
      <p className="reconcile-muted">Residents of barangays with an active disaster event who are not in the rescued directory and have no open report.</p>
      <div className="reconcile-table-wrap"><table className="reconcile-table">
        <thead><tr><th>Name</th><th>Barangay</th><th>Latest evacuation status</th><th>Logged</th></tr></thead>
        <tbody>{result.unaccounted.map(r => <tr key={r.uid}>
          <td>{fullName(r)}</td><td>{barangayName(r.barangay_id)}</td>
          <td>{r.latest_status ? statusLabels[r.latest_status] : 'No evacuation record'}</td>
          <td>{formatTime(r.latest_logged_at)}</td>
        </tr>)}</tbody>
      </table></div>
    </section>}

    <section className="panel">
      <div className="reconcile-header"><h3>Master rescued directory</h3>
        <input className="reconcile-search" type="search" placeholder="Search name or center" value={directorySearch} onChange={e => setDirectorySearch(e.target.value)} /></div>
      {result && !directory.length && <p>No safely evacuated residents{directorySearch ? ' match your search' : ' in your scope'}.</p>}
      {directory.length > 0 && <div className="reconcile-table-wrap"><table className="reconcile-table">
        <thead><tr><th>Name</th><th>Barangay</th><th>Sex</th><th>Age</th><th>Evacuation center</th><th>Evacuated</th></tr></thead>
        <tbody>{directory.map(r => <tr key={r.uid}>
          <td>{fullName(r)}</td><td>{barangayName(r.barangay_id)}</td><td>{r.sex ?? '—'}</td>
          <td>{ageOn(r.birthdate, new Date()) ?? '—'}</td><td>{r.center_name ?? '—'}</td>
          <td>{formatTime(r.evacuated_at ?? r.latest_logged_at)}</td>
        </tr>)}</tbody>
      </table></div>}
    </section>

    {result && result.closed.length > 0 && <section className="panel">
      <h3>Closed reports</h3>
      <div className="reconcile-table-wrap"><table className="reconcile-table">
        <thead><tr><th>Name</th><th>Outcome</th><th>Matched resident</th><th>Note</th><th>Closed</th></tr></thead>
        <tbody>{result.closed.map(r => {
          const matched = r.matched_resident_uid ? data?.residents.find(x => x.uid === r.matched_resident_uid) : null
          return <tr key={r.report_id}>
            <td>{r.full_name}</td>
            <td><span className={`reconcile-badge ${r.status}`}>{r.status === 'found' ? 'Found' : 'Withdrawn'}</span></td>
            <td>{matched ? `${fullName(matched)} · ${matched.center_name ?? '—'}` : '—'}</td>
            <td>{r.reconciliation_note}</td>
            <td>{formatTime(r.reconciled_at)}</td>
          </tr>
        })}</tbody>
      </table></div>
    </section>}
  </div>
}
