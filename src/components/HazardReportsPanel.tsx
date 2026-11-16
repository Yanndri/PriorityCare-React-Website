import { useEffect, useState } from 'react'
import {
  getHazardReports, HAZARD_STATUS_LABELS, HAZARD_TYPE_LABELS, reviewHazard,
  type HazardAction, type HazardReport,
} from '../api/hazardReportsApi'
import { useLiveSignal } from '../lib/useLiveSignal'

const fmt = (iso: string) => new Date(iso).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })
const OPEN = new Set(['unverified', 'under_review', 'confirmed'])
const ACTIONS: Record<string, { action: HazardAction; label: string; needsNote?: boolean; primary?: boolean }[]> = {
  unverified: [
    { action: 'confirm', label: 'Confirm', primary: true },
    { action: 'review', label: 'Send someone to check', needsNote: true },
    { action: 'dismiss', label: 'Dismiss', needsNote: true },
  ],
  under_review: [
    { action: 'confirm', label: 'Confirm', primary: true },
    { action: 'dismiss', label: 'Dismiss', needsNote: true },
  ],
  confirmed: [{ action: 'resolve', label: 'Mark cleared', primary: true }],
}

// Hazards reported from the app: admins confirm them (they then show on every resident's map),
// dismiss false reports, or mark them cleared.
export function HazardReportsPanel() {
  const [rows, setRows] = useState<HazardReport[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [showClosed, setShowClosed] = useState(false)
  const [pending, setPending] = useState<{ id: string; action: HazardAction; label: string; note: string } | null>(null)

  const load = () => getHazardReports().then((r) => { setRows(r); setError('') })
    .catch((e) => setError(e instanceof Error ? e.message : 'Unable to load hazard reports.'))
  useEffect(() => {
    let cancelled = false
    getHazardReports().then((r) => { if (!cancelled) setRows(r) })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Unable to load hazard reports.') })
    return () => { cancelled = true }
  }, [])
  useLiveSignal(['hazards'], () => { void load() })

  async function act(id: string, action: HazardAction, note = '') {
    setBusy(true); setError('')
    try { await reviewHazard(id, action, note); setPending(null); await load() }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not update the hazard.') }
    finally { setBusy(false) }
  }

  const open = (rows ?? []).filter((r) => OPEN.has(r.status))
  const closed = (rows ?? []).filter((r) => !OPEN.has(r.status))
  const list = showClosed ? closed : open

  return <section className="panel hazard-panel">
    <div className="hazard-panel-head">
      <h3>Hazards reported from the app {open.length > 0 && <span className="hazard-count">{open.length}</span>}</h3>
      <div className="hazard-toggle" role="tablist">
        <button type="button" role="tab" aria-selected={!showClosed} onClick={() => setShowClosed(false)}>Open ({open.length})</button>
        <button type="button" role="tab" aria-selected={showClosed} onClick={() => setShowClosed(true)}>Closed, last 7 days ({closed.length})</button>
      </div>
    </div>
    <p className="dispatch-muted">Confirmed hazards appear on every resident's and rescuer's map.</p>
    {error && <p role="alert" className="dispatch-error">{error}</p>}
    {!rows && !error && <p role="status">Loading hazard reports…</p>}
    {rows && list.length === 0 && <p className="dispatch-muted">{showClosed ? 'Nothing closed in the last 7 days.' : 'No open hazard reports.'}</p>}
    <div className="hazard-list">
      {list.map((h) => <article key={h.hazard_id} className={`hazard-item hz-${h.status}`}>
        <div className="hazard-main">
          <div><strong>{HAZARD_TYPE_LABELS[h.hazard_type] ?? h.hazard_type}</strong>
            <span className={`hazard-status hs-${h.status}`}>{HAZARD_STATUS_LABELS[h.status]}</span></div>
          {h.description && <div>"{h.description}"</div>}
          <div className="dispatch-muted">
            {h.barangay_name ? `Brgy. ${h.barangay_name}` : 'Barangay unknown'} · reported by a {h.reporter_role === 'rescuer' ? 'rescuer' : 'resident'} · {fmt(h.created_at)} ·{' '}
            <a href={`https://www.openstreetmap.org/?mlat=${h.latitude}&mlon=${h.longitude}#map=18/${h.latitude}/${h.longitude}`} target="_blank" rel="noreferrer">See location</a>
          </div>
          {h.review_note && <div className="dispatch-muted">Note: {h.review_note}</div>}
        </div>
        {pending?.id === h.hazard_id ? <form className="hazard-note" onSubmit={(e) => { e.preventDefault(); void act(h.hazard_id, pending.action, pending.note) }}>
          <label>Why? (required)<input autoFocus required maxLength={500} value={pending.note} onChange={(e) => setPending({ ...pending, note: e.target.value })} /></label>
          <div className="ticket-actions">
            <button type="submit" className="verify-button" disabled={busy}>{pending.label}</button>
            <button type="button" className="secondary-button" disabled={busy} onClick={() => setPending(null)}>Back</button>
          </div>
        </form> : <div className="ticket-actions">
          {(ACTIONS[h.status] ?? []).map((a) => <button key={a.action} type="button" disabled={busy}
            className={a.primary ? 'verify-button' : 'secondary-button'}
            onClick={() => a.needsNote ? setPending({ id: h.hazard_id, action: a.action, label: a.label, note: '' }) : void act(h.hazard_id, a.action)}>
            {a.label}</button>)}
        </div>}
      </article>)}
    </div>
  </section>
}
