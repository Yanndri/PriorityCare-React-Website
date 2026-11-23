import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useScopeBarangay } from '../lib/scope'
import {
  alarmLabel, DECLARABLE, declareFromHazard, getHazardAlarms, getHazardReporters, getHazardReports, HAZARD_STATUS_LABELS, HAZARD_TYPE_LABELS,
  linkHazardToEvent, reviewHazard, type HazardAction, type HazardAlarm, type HazardReport, type HazardReporter,
} from '../api/hazardReportsApi'
import { getEventRegister, type DisasterEvent } from '../api/disasterEventsApi'
import { useLiveSignal } from '../lib/useLiveSignal'

const fmt = (iso: string) => new Date(iso).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })
const OPEN = new Set(['unverified', 'under_review', 'confirmed'])
const ACTIONS: Record<string, { action: HazardAction; label: string; needsNote?: boolean; primary?: boolean }[]> = {
  // The check itself happens outside the system (a call, a responder on site); the admin records the answer.
  unverified: [
    { action: 'confirm', label: "Yes, it's real", primary: true },
    { action: 'dismiss', label: 'No, false report', needsNote: true },
  ],
  under_review: [
    { action: 'confirm', label: "Yes, it's real", primary: true },
    { action: 'dismiss', label: 'No, false report', needsNote: true },
  ],
  confirmed: [
    { action: 'resolve', label: 'Mark cleared', primary: true },
    { action: 'dismiss', label: 'Undo (it was not real)', needsNote: true },
  ],
  // Forgiving: a wrong No or an early "cleared" can be reopened, then answered again.
  dismissed: [{ action: 'review', label: 'Reopen (answered by mistake)', needsNote: true }],
  resolved: [{ action: 'review', label: 'Reopen (still there)', needsNote: true }],
}

// Hazards reported from the app: admins confirm them (they then show on every resident's map),
// dismiss false reports, or mark them cleared.
export function HazardReportsPanel() {
  const [rawRows, setRows] = useState<HazardReport[] | null>(null)
  // Only the barangay chosen in the Scope selector (all of them for "All barangays").
  const scope = useScopeBarangay()
  const rows = useMemo(() => (rawRows && scope != null ? rawRows.filter((r) => r.barangay_id === scope) : rawRows), [rawRows, scope])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [showClosed, setShowClosed] = useState(false)
  const [pending, setPending] = useState<{ id: string; action: HazardAction; label: string; note: string } | null>(null)
  const [alarms, setAlarms] = useState<Map<string, HazardAlarm>>(new Map())
  // Disasters in this admin's scope: a report can be declared as one, or added to an active one.
  const [events, setEvents] = useState<DisasterEvent[]>([])
  const [reporters, setReporters] = useState<Map<string, HazardReporter>>(new Map())
  useEffect(() => {
    if (!rows?.length) return
    let cancelled = false
    getHazardReporters(rows.map((r) => r.hazard_id)).then((m) => { if (!cancelled) setReporters(m) })
    return () => { cancelled = true }
  }, [rows])
  const [declaring, setDeclaring] = useState<{ id: string; name: string; location: string } | null>(null)
  const [notice, setNotice] = useState('')
  const loadEvents = () => getEventRegister().then((r) => setEvents(r.events)).catch(() => { /* no declare rights */ })

  const load = () => Promise.all([getHazardReports(), getHazardAlarms()]).then(([r, a]) => { setRows(r); setAlarms(a); setError('') })
    .catch((e) => setError(e instanceof Error ? e.message : 'Unable to load hazard reports.'))
  useEffect(() => {
    let cancelled = false
    getHazardReports().then((r) => { if (!cancelled) setRows(r) })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Unable to load hazard reports.') })
    getHazardAlarms().then((a) => { if (!cancelled) setAlarms(a) })
    getEventRegister().then((r) => { if (!cancelled) setEvents(r.events) }).catch(() => { /* no declare rights */ })
    return () => { cancelled = true }
  }, [])
  useLiveSignal(['hazards'], () => { void load() })
  useLiveSignal(['events'], () => { void loadEvents() })

  async function declare(e: FormEvent) {
    e.preventDefault()
    if (!declaring) return
    setBusy(true); setError(''); setNotice('')
    try {
      await declareFromHazard(declaring.id, declaring.name, declaring.location)
      setDeclaring(null); setNotice('Disaster declared. Residents of the barangay are alerted, and the operation has started.')
      await Promise.all([load(), loadEvents()])
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not declare the disaster.') }
    finally { setBusy(false) }
  }
  async function addTo(hazardId: string, eventId: string) {
    setBusy(true); setError(''); setNotice('')
    try { await linkHazardToEvent(hazardId, eventId); setNotice('Report added to the disaster.'); await load() }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not add the report.') }
    finally { setBusy(false) }
  }
  const activeEvents = events.filter((ev) => ev.status === 'active')
  const eventName = (id: string | null) => events.find((ev) => ev.event_id === id)?.name

  async function act(id: string, action: HazardAction, note = '') {
    setBusy(true); setError('')
    try { await reviewHazard(id, action, note); setPending(null); await load() }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not update the hazard.') }
    finally { setBusy(false) }
  }

  const level = (id: string) => alarms.get(id)?.alarm_level ?? 1
  // Highest alarm first, so repeat reports rise to the top.
  const open = (rows ?? []).filter((r) => OPEN.has(r.status)).sort((a, b) => level(b.hazard_id) - level(a.hazard_id))
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
    <p className="dispatch-muted">Check the report outside the system (call the reporter or ask a responder nearby), then answer Yes or No. Confirmed hazards appear on every resident's and responder's map. A 2nd or 3rd alarm means other people near the spot reported or confirmed it too.</p>
    {error && <p role="alert" className="dispatch-error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!rows && !error && <p role="status">Loading hazard reports…</p>}
    {rows && list.length === 0 && <p className="dispatch-muted">{showClosed ? 'Nothing closed in the last 7 days.' : 'No open hazard reports.'}</p>}
    <div className="hazard-list">
      {list.map((h) => <article key={h.hazard_id} className={`hazard-item hz-${h.status}`}>
        <div className="hazard-main">
          <div><strong>{HAZARD_TYPE_LABELS[h.hazard_type] ?? h.hazard_type}</strong>
            <span className={`hazard-status hs-${h.status}`}>{HAZARD_STATUS_LABELS[h.status]}</span>
            {OPEN.has(h.status) && alarms.has(h.hazard_id) && <span className={`hazard-alarm alarm-${Math.min(level(h.hazard_id), 3)}`}
              title={`${alarms.get(h.hazard_id)!.confirmations} people nearby said they see it · ${alarms.get(h.hazard_id)!.nearby_reports} other reports close by`}>
              {alarmLabel(level(h.hazard_id))}</span>}</div>
          {OPEN.has(h.status) && level(h.hazard_id) >= 2 && <div className="dispatch-muted">
            Probably real: {alarms.get(h.hazard_id)!.confirmations} people nearby confirmed it and {alarms.get(h.hazard_id)!.nearby_reports} other reports came from the same area.</div>}
          {h.description && <div>"{h.description}"</div>}
          <div className="dispatch-muted">
            {h.barangay_name ? `Brgy. ${h.barangay_name}` : 'Barangay unknown'} · reported by {reporters.get(h.hazard_id)?.reporter_name
              ? <>{reporters.get(h.hazard_id)!.reporter_name} ({h.reporter_role === 'rescuer' ? 'responder' : 'resident'}){reporters.get(h.hazard_id)!.contact_no
                ? <>, <a href={`tel:${reporters.get(h.hazard_id)!.contact_no}`}>{reporters.get(h.hazard_id)!.contact_no}</a></> : null}</>
              : `a ${h.reporter_role === 'rescuer' ? 'responder' : 'resident'}`}
            {reporters.get(h.hazard_id)?.reporter_verified === false && <> <span className="hazard-status hs-under_review" title="Not verified by the barangay yet: their reports count less toward the alarm level.">Account not verified</span></>} · {fmt(h.created_at)} ·{' '}
            <a href={`https://www.openstreetmap.org/?mlat=${h.latitude}&mlon=${h.longitude}#map=18/${h.latitude}/${h.longitude}`} target="_blank" rel="noreferrer">See location</a>
          </div>
          {h.review_note && <div className="dispatch-muted">Note: {h.review_note}</div>}
          {h.event_id && <div className="hazard-event-tag">Part of the declared disaster: {eventName(h.event_id) ?? 'a declared disaster'}</div>}
        </div>
        {declaring?.id === h.hazard_id ? <form className="hazard-note" onSubmit={(e) => { void declare(e) }}>
          <label>Disaster name<input autoFocus required maxLength={120} value={declaring.name} onChange={(e) => setDeclaring({ ...declaring, name: e.target.value })} /></label>
          <label>Affected location / landmark<input required maxLength={500} value={declaring.location} onChange={(e) => setDeclaring({ ...declaring, location: e.target.value })} /></label>
          <p className="dispatch-muted">Type, barangay, map pin and onset time come from the report. This sounds the alarm for residents of the barangay.</p>
          <div className="ticket-actions">
            <button type="submit" className="verify-button" disabled={busy}>Declare disaster</button>
            <button type="button" className="secondary-button" disabled={busy} onClick={() => setDeclaring(null)}>Back</button>
          </div>
        </form> : pending?.id === h.hazard_id ? <form className="hazard-note" onSubmit={(e) => { e.preventDefault(); void act(h.hazard_id, pending.action, pending.note) }}>
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
          {OPEN.has(h.status) && !h.event_id && DECLARABLE[h.hazard_type] && <>
            {activeEvents.filter((ev) => ev.barangay_id === h.barangay_id).map((ev) => <button key={ev.event_id} type="button"
              className="secondary-button" disabled={busy} onClick={() => void addTo(h.hazard_id, ev.event_id)}>Add to {ev.name}</button>)}
            <button type="button" className="hazard-declare-button" disabled={busy}
              onClick={() => setDeclaring({ id: h.hazard_id,
                name: `${DECLARABLE[h.hazard_type]} in Brgy. ${h.barangay_name ?? ''}, ${new Date(h.created_at).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric' })}`,
                location: (h.description || 'See the map pin').slice(0, 500) })}>
              Declare as disaster</button>
          </>}
        </div>}
      </article>)}
    </div>
  </section>
}
