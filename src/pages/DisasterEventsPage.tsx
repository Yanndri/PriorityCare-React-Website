import { useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { useScopeBarangay } from '../lib/scope'
import { useLiveSignal } from '../lib/useLiveSignal'
import { useShowOnMap } from '../lib/showOnMap'
import { declareEvent, getEventRegister, hazardLabels, resolveEvent } from '../api/disasterEventsApi'
import type { DisasterEvent, EventRegister, HazardType } from '../api/disasterEventsApi'
import {
  alarmLabel, DECLARABLE, declareFromHazard, getHazardAlarms, getHazardReporters, getHazardReports, HAZARD_STATUS_LABELS, HAZARD_TYPE_LABELS,
  linkHazardToEvent, reviewHazard, type HazardAction, type HazardAlarm, type HazardReport, type HazardReporter,
} from '../api/hazardReportsApi'
import { DisasterAreaPicker } from '../components/DisasterAreaPicker'
import { SidePanel } from '../components/SidePanel'
import { TicketLocationMap } from '../components/TicketLocationMap'
import { elapsed } from '../utils/dispatch'
import './DispatchPage.css'
import './DisasterEventsPage.css'

// Alarms page: hazard reports from the app and the disasters they start, in one list on the left
// (grouped by what to do next) and the chosen one on the right with one big next step.
// Same layout as the Operation page.

function manilaNow() {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 16)
}
const formatTime = (value: string) => new Date(value).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })

// Common reasons for ending a declaration; "Other" lets staff type their own.
const RESOLUTION_REASONS = [
  'Hazard has passed (water receded, fire out, shaking stopped)',
  'All affected residents are safe and accounted for',
  'Evacuees have returned home',
  'Declared by mistake or a duplicate',
  'Moved under a municipal or wider declaration',
]
const OTHER_REASON = 'Other'
// What residents are told when a disaster ends. The resident app reads it back from the
// saved reason ("Advice to residents: <advice>. Reason: <reason>") and shows it to them.
const ADVICE_OPTIONS = ['Safe to go home', 'Stay at the evacuation center for now']
const WAITING = new Set(['unverified', 'under_review'])

type Group = 'waiting' | 'confirmed' | 'active' | 'closed'
type Item =
  | { kind: 'hazard'; key: string; h: HazardReport; group: Group; at: string }
  | { kind: 'event'; key: string; ev: DisasterEvent; group: Group; at: string }
const GROUPS: { key: Group; title: string; counter: string }[] = [
  { key: 'waiting', title: 'Waiting for your answer', counter: 'Waiting for Yes / No' },
  { key: 'confirmed', title: 'Confirmed, not declared', counter: 'Confirmed, not declared' },
  { key: 'active', title: 'Active disasters', counter: 'Active disasters' },
  { key: 'closed', title: 'Closed', counter: 'Closed (7 days)' },
]
const WEEK = 7 * 24 * 3600 * 1000

export function DisasterEventsPage() {
  const scope = useScopeBarangay()
  const showOnMap = useShowOnMap()
  const [rawRegister, setRegister] = useState<EventRegister | null>(null)
  const [rawRows, setRows] = useState<HazardReport[] | null>(null)
  const [alarms, setAlarms] = useState<Map<string, HazardAlarm>>(new Map())
  const [reporters, setReporters] = useState<Map<string, HazardReporter>>(new Map())
  const register = useMemo(() => (rawRegister && scope != null ? {
    ...rawRegister,
    barangays: rawRegister.barangays.filter((b) => b.barangay_id === scope),
    events: rawRegister.events.filter((e) => e.barangay_id === scope),
  } : rawRegister), [rawRegister, scope])
  const rows = useMemo(() => (rawRows && scope != null ? rawRows.filter((r) => r.barangay_id === scope) : rawRows), [rawRows, scope])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [sel, setSel] = useState<string | null>(null)
  const [groupFilter, setGroupFilter] = useState<Group | null>(null)
  const [closedOpen, setClosedOpen] = useState(false)
  // Small forms inside the detail panel.
  const [pending, setPending] = useState<{ id: string; action: HazardAction; label: string; note: string } | null>(null)
  const [declaring, setDeclaring] = useState<{ id: string; name: string; location: string } | null>(null)
  const [resolving, setResolving] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [advice, setAdvice] = useState('')
  const [reasonChoice, setReasonChoice] = useState('')
  // "Declare without a report" form (side panel).
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [hazard, setHazard] = useState<HazardType>('flood')
  const [barangay, setBarangay] = useState('')
  const [location, setLocation] = useState('')
  const [onset, setOnset] = useState(manilaNow)
  const [notes, setNotes] = useState('')
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null)

  const loadHazards = () => Promise.all([getHazardReports(), getHazardAlarms()]).then(([r, a]) => { setRows(r); setAlarms(a) })
  const loadEvents = () => getEventRegister().then(setRegister)
  async function reload() {
    try { await Promise.all([loadHazards(), loadEvents()]) }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to load alarms.') }
  }
  useEffect(() => {
    let cancelled = false
    Promise.all([getHazardReports(), getHazardAlarms(), getEventRegister()])
      .then(([r, a, reg]) => { if (!cancelled) { setRows(r); setAlarms(a); setRegister(reg) } })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Unable to load alarms.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])
  useEffect(() => {
    if (!rows?.length) return
    let cancelled = false
    getHazardReporters(rows.map((r) => r.hazard_id)).then((m) => { if (!cancelled) setReporters(m) })
    return () => { cancelled = true }
  }, [rows])
  useLiveSignal(['hazards'], () => { void loadHazards().catch(() => { /* keep what is shown */ }) })
  useLiveSignal(['events'], () => { void loadEvents().catch(() => { /* keep what is shown */ }) })

  async function run(work: () => Promise<unknown>, done: string) {
    setBusy(true); setError(''); setNotice('')
    try { await work(); setNotice(done); setPending(null); setDeclaring(null); setResolving(null); await reload(); return true }
    catch (e) { setError(e instanceof Error ? e.message : 'That did not work. Try again.'); return false }
    finally { setBusy(false) }
  }

  // ---------------------------------------------------------------- the list
  const events = useMemo(() => register?.events ?? [], [register])
  const barangayName = (id: number | null) => register?.barangays.find((b) => b.barangay_id === id)?.barangay_name ?? ''
  const level = (id: string) => alarms.get(id)?.alarm_level ?? 1
  // "Ended in the last 7 days" is counted from when the page opened.
  const [now] = useState(() => Date.now())
  const items: Item[] = [
    ...(rows ?? []).filter((h) => !(h.status === 'confirmed' && h.event_id)).map((h): Item => ({
      kind: 'hazard', key: `h:${h.hazard_id}`, h, at: h.created_at,
      group: WAITING.has(h.status) ? 'waiting' : h.status === 'confirmed' ? 'confirmed' : 'closed',
    })),
    ...events.filter((ev) => ev.status === 'active' || (ev.resolved_at && now - Date.parse(ev.resolved_at) < WEEK)).map((ev): Item => ({
      kind: 'event', key: `e:${ev.event_id}`, ev, at: ev.status === 'active' ? ev.declared_at : ev.resolved_at ?? ev.declared_at,
      group: ev.status === 'active' ? 'active' : 'closed',
    })),
  ]
  const counts: Record<Group, number> = { waiting: 0, confirmed: 0, active: 0, closed: 0 }
  items.forEach((i) => { counts[i.group] += 1 })
  const sorted = (g: Group) => items.filter((i) => i.group === g && (!groupFilter || groupFilter === g)).sort((a, b) =>
    g === 'waiting' && a.kind === 'hazard' && b.kind === 'hazard'
      // Highest alarm first, so repeat reports rise to the top; then the oldest.
      ? level(b.h.hazard_id) - level(a.h.hazard_id) || Date.parse(a.at) - Date.parse(b.at)
      : Date.parse(b.at) - Date.parse(a.at))
  const groups = GROUPS.map((g) => ({ ...g, list: sorted(g.key) }))
  const firstOpen = groups.filter((g) => g.key !== 'closed').flatMap((g) => g.list)[0]
  const selected = items.find((i) => i.key === sel) ?? firstOpen
  const showClosed = closedOpen || groupFilter === 'closed'

  function pick(key: string) {
    setSel(key); setPending(null); setDeclaring(null); setResolving(null)
    if (window.innerWidth < 1000) setTimeout(() => document.getElementById('alarm-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
  }

  function renderRow(i: Item) {
    const isSel = selected?.key === i.key
    let title: string, sub: string, pill: ReactNode, tone: string
    if (i.kind === 'hazard') {
      const h = i.h, lv = level(h.hazard_id), who = reporters.get(h.hazard_id)?.reporter_name
      title = `${HAZARD_TYPE_LABELS[h.hazard_type] ?? h.hazard_type} · ${h.barangay_name ?? 'Barangay unknown'}`
      sub = h.description ? `"${h.description}"` : `Reported by ${who ?? `a ${h.reporter_role === 'rescuer' ? 'responder' : 'resident'}`}`
      tone = i.group === 'closed' ? 'normal' : lv >= 3 ? 'critical' : lv === 2 || i.group === 'confirmed' ? 'high' : 'normal'
      pill = i.group === 'waiting'
        ? <span className={`op-pill ${lv >= 3 ? 'pill-sos' : lv === 2 ? 'pill-wait' : 'pill-grey'}`}>{alarmLabel(lv)}</span>
        : <span className={`op-pill ${i.group === 'confirmed' ? 'pill-wait' : 'pill-grey'}`}>{HAZARD_STATUS_LABELS[h.status]}</span>
    } else {
      const ev = i.ev
      title = ev.name
      sub = `${hazardLabels[ev.hazard_type]} · ${barangayName(ev.barangay_id)} · ${ev.location_description}`
      tone = ev.status === 'active' ? 'critical' : 'normal'
      pill = <span className={`op-pill ${ev.status === 'active' ? 'pill-step' : 'pill-grey'}`}>{ev.status === 'active' ? 'Active' : 'Ended'}</span>
    }
    return <li key={i.key}>
      <button type="button" className={`op-row prio-${tone}${isSel ? ' is-selected' : ''}${i.group === 'closed' ? ' is-closed' : ''}`}
        aria-current={isSel ? 'true' : undefined} onClick={() => pick(i.key)}>
        <span className="op-row-main"><strong>{title}</strong><span className="op-row-sub">{sub}</span></span>
        <span className="op-row-side">{pill}<span className="op-row-age">{elapsed(i.at)}</span></span>
      </button>
    </li>
  }

  const smallMap = (lat: number | null, lng: number | null) => lat != null && lng != null
    ? <div className="op-map"><TicketLocationMap latitude={String(lat)} longitude={String(lng)} fixed onChange={() => { /* view only */ }} /></div> : null
  const bigMapButton = (lat: number | null, lng: number | null, label: string) => showOnMap && lat != null && lng != null
    ? <button type="button" className="secondary-button" onClick={() => showOnMap({ lat, lng, label })}>See on big map</button> : null

  // ---------------------------------------------------------------- a hazard report
  function renderHazard(h: HazardReport) {
    const lv = level(h.hazard_id)
    const al = alarms.get(h.hazard_id)
    const who = reporters.get(h.hazard_id)
    const typeLabel = HAZARD_TYPE_LABELS[h.hazard_type] ?? h.hazard_type
    const sameBarangayEvents = events.filter((ev) => ev.status === 'active' && ev.barangay_id === h.barangay_id)
    const canDeclare = h.status === 'confirmed' && !h.event_id && !!DECLARABLE[h.hazard_type]
    const ask = (action: HazardAction, label: string) => setPending({ id: h.hazard_id, action, label, note: '' })
    const mine = pending?.id === h.hazard_id ? pending : null
    return <>
      <div className="op-detail-head">
        <h3>{typeLabel} · {h.barangay_name ?? 'Barangay unknown'}
          {WAITING.has(h.status) && al && <span className={`hazard-alarm alarm-${Math.min(lv, 3)}`}>{alarmLabel(lv)}</span>}
          <span className={`hazard-status hs-${h.status}`}>{HAZARD_STATUS_LABELS[h.status]}</span></h3>
        <p className="dispatch-muted">Reported {elapsed(h.created_at)} ago ({formatTime(h.created_at)}) by{' '}
          {who?.reporter_name
            ? <>{who.reporter_name} ({h.reporter_role === 'rescuer' ? 'responder' : 'resident'}){who.contact_no && <> · <a href={`tel:${who.contact_no}`}>{who.contact_no}</a></>}</>
            : `a ${h.reporter_role === 'rescuer' ? 'responder' : 'resident'}`}
          {who?.reporter_verified === false && <> <span className="hazard-status hs-under_review" title="Not verified by the barangay yet: their reports count less toward the alarm level.">Account not verified</span></>}</p>
      </div>
      {h.description && <p className="sos-note">"{h.description}"</p>}
      {WAITING.has(h.status) && lv >= 2 && al && <p className="dispatch-muted"><strong>Probably real:</strong> {al.confirmations} people nearby confirmed it and {al.nearby_reports} other reports came from the same area.</p>}
      {WAITING.has(h.status) && <p className="dispatch-muted">Check it outside the system first (call the reporter or ask a responder nearby), then answer.</p>}
      {smallMap(h.latitude, h.longitude)}
      {h.review_note && <p className="dispatch-muted">Note: {h.review_note}</p>}
      {h.event_id && <p className="hazard-event-tag">Part of the declared disaster: {events.find((ev) => ev.event_id === h.event_id)?.name ?? 'a declared disaster'}</p>}

      {mine ? <form className="ticket-action-form" onSubmit={(e) => { e.preventDefault(); void run(() => reviewHazard(h.hazard_id, mine.action, mine.note), `${typeLabel} report: ${mine.label.toLowerCase()}.`) }}>
        <h4>{mine.label}</h4>
        <label>Why? (required)<input autoFocus required maxLength={500} value={mine.note} onChange={(e) => setPending({ ...mine, note: e.target.value })} /></label>
        <div className="ticket-actions">
          <button type="submit" className="verify-button" disabled={busy}>Confirm</button>
          <button type="button" className="secondary-button" disabled={busy} onClick={() => setPending(null)}>Back</button>
        </div>
      </form>
      : declaring?.id === h.hazard_id ? <form className="ticket-action-form" onSubmit={(e) => { e.preventDefault()
          void run(() => declareFromHazard(h.hazard_id, declaring.name, declaring.location), 'Disaster declared. Residents of the barangay are alerted, and the operation has started.') }}>
        <h4>Declare as disaster</h4>
        <label>Disaster name<input autoFocus required maxLength={120} value={declaring.name} onChange={(e) => setDeclaring({ ...declaring, name: e.target.value })} /></label>
        <label>Affected location / landmark<input required maxLength={500} value={declaring.location} onChange={(e) => setDeclaring({ ...declaring, location: e.target.value })} /></label>
        <p className="dispatch-muted">Type, barangay, map pin and onset time come from the report. This sounds the alarm for residents of the barangay.</p>
        <div className="ticket-actions">
          <button type="submit" className="hazard-declare-button" disabled={busy}>Declare disaster</button>
          <button type="button" className="secondary-button" disabled={busy} onClick={() => setDeclaring(null)}>Back</button>
        </div>
      </form>
      : <>
        {WAITING.has(h.status) && <div className="alarm-answer">
          <button type="button" className="op-next" disabled={busy} onClick={() => void run(() => reviewHazard(h.hazard_id, 'confirm'), `${typeLabel} report confirmed. It now shows on every resident's and responder's map.`)}>Yes, it's real</button>
          <button type="button" className="op-next op-next-no" disabled={busy} onClick={() => ask('dismiss', 'No, false report')}>No, false report</button>
        </div>}
        {canDeclare && <button type="button" className="op-next op-next-declare" disabled={busy}
          onClick={() => setDeclaring({ id: h.hazard_id,
            name: `${DECLARABLE[h.hazard_type]} in Brgy. ${h.barangay_name ?? ''}, ${new Date(h.created_at).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric' })}`,
            location: (h.description || 'See the map pin').slice(0, 500) })}>Declare as disaster</button>}
        {h.status === 'confirmed' && !canDeclare && !h.event_id && <button type="button" className="op-next" disabled={busy}
          onClick={() => void run(() => reviewHazard(h.hazard_id, 'resolve'), `${typeLabel} report marked cleared.`)}>Mark cleared</button>}
      </>}

      {!mine && declaring?.id !== h.hazard_id && <div className="op-small">
        {h.status === 'confirmed' && !h.event_id && DECLARABLE[h.hazard_type] && sameBarangayEvents.map((ev) =>
          <button key={ev.event_id} type="button" className="secondary-button" disabled={busy}
            onClick={() => void run(() => linkHazardToEvent(h.hazard_id, ev.event_id), `Report added to ${ev.name}.`)}>Add to {ev.name}</button>)}
        {h.status === 'confirmed' && canDeclare && <button type="button" className="secondary-button" disabled={busy}
          onClick={() => void run(() => reviewHazard(h.hazard_id, 'resolve'), `${typeLabel} report marked cleared.`)}>Mark cleared</button>}
        {h.status === 'confirmed' && <button type="button" className="secondary-button" disabled={busy} onClick={() => ask('dismiss', 'Undo (it was not real)')}>Undo (it was not real)</button>}
        {h.status === 'dismissed' && <button type="button" className="secondary-button" disabled={busy} onClick={() => ask('review', 'Reopen (answered by mistake)')}>Reopen (answered by mistake)</button>}
        {h.status === 'resolved' && <button type="button" className="secondary-button" disabled={busy} onClick={() => ask('review', 'Reopen (still there)')}>Reopen (still there)</button>}
        {bigMapButton(h.latitude, h.longitude, `${typeLabel} report`)}
      </div>}
    </>
  }

  // ---------------------------------------------------------------- a declared disaster
  const fullReason = reasonChoice === OTHER_REASON ? reason.trim()
    : reason.trim() ? `${reasonChoice}: ${reason.trim()}` : reasonChoice
  const savedReason = advice && fullReason ? `Advice to residents: ${advice}. Reason: ${fullReason}` : ''
  function renderEvent(ev: DisasterEvent) {
    const linked = (rows ?? []).filter((h) => h.event_id === ev.event_id)
    return <>
      <div className="op-detail-head">
        <h3>{ev.name} <span className={`disaster-status ${ev.status}`}>{ev.status === 'active' ? 'Active' : 'Ended'}</span></h3>
        <p className="dispatch-muted">{hazardLabels[ev.hazard_type]} · {barangayName(ev.barangay_id)} · declared {elapsed(ev.declared_at)} ago</p>
      </div>
      <dl className="op-facts">
        <dt>Where</dt><dd>{ev.location_description}</dd>
        <dt>Started</dt><dd>{formatTime(ev.started_at)}</dd>
        <dt>Declared</dt><dd>{formatTime(ev.declared_at)}</dd>
        {ev.notes && <><dt>Notes</dt><dd className="disaster-notes">{ev.notes}</dd></>}
        {linked.length > 0 && <><dt>Reports in it</dt><dd>{linked.length} report{linked.length === 1 ? '' : 's'} from the app</dd></>}
        {ev.status === 'resolved' && <><dt>Ended</dt><dd>{formatTime(ev.resolved_at!)} · {ev.resolution_reason}</dd></>}
      </dl>
      {smallMap(ev.latitude, ev.longitude)}
      {ev.status === 'active' && (resolving === ev.event_id
        ? <form className="ticket-action-form" onSubmit={(e: FormEvent) => { e.preventDefault()
            void run(async () => { await resolveEvent(ev.event_id, savedReason); setReason(''); setReasonChoice(''); setAdvice('') }, `Disaster ended. Residents of the barangay were told: ${advice}.`) }}>
            <h4>End this disaster</h4>
            <label>Reason<select required value={reasonChoice} onChange={(e) => setReasonChoice(e.target.value)}>
              <option value="">Choose a reason</option>{RESOLUTION_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}<option value={OTHER_REASON}>{OTHER_REASON}</option></select></label>
            {reasonChoice && <label>{reasonChoice === OTHER_REASON ? 'Describe the reason' : 'Details (optional)'}
              <textarea required={reasonChoice === OTHER_REASON} maxLength={900} value={reason} onChange={(e) => setReason(e.target.value)} /></label>}
            <fieldset className="end-advice">
              <legend>Advice to residents</legend>
              {ADVICE_OPTIONS.map((a) => <label key={a} className="end-advice-option">
                <input type="radio" name="end-advice" required value={a} checked={advice === a} onChange={() => setAdvice(a)} /> {a}</label>)}
            </fieldset>
            <p className="dispatch-muted">Residents of the barangay see this advice in the app right away. This ends the declaration and clears its hazard reports. Its history is kept.</p>
            <div className="ticket-actions">
              <button type="submit" className="verify-button" disabled={busy || !savedReason}>End disaster and advise residents</button>
              <button type="button" className="secondary-button" disabled={busy} onClick={() => setResolving(null)}>Back</button>
            </div>
          </form>
        : <button type="button" className="op-next" disabled={busy} onClick={() => { setResolving(ev.event_id); setReason(''); setReasonChoice(''); setAdvice('') }}>End this disaster</button>)}
      <div className="op-small">{bigMapButton(ev.latitude, ev.longitude, ev.name)}</div>
    </>
  }

  // ---------------------------------------------------------------- declare without a report
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setNotice('')
    const startedAt = new Date(`${onset}:00+08:00`)
    if (!Number.isFinite(startedAt.getTime()) || startedAt.getTime() > Date.now()) {
      setError('Enter an onset time that is not in the future (Philippine time).'); return
    }
    const ok = await run(() => declareEvent({ barangay: Number(barangay || register?.barangays[0]?.barangay_id), name, hazard, location,
      startedAt: startedAt.toISOString(), notes, latitude: pin?.lat ?? null, longitude: pin?.lng ?? null }), 'Disaster declared.')
    if (ok) { setName(''); setLocation(''); setNotes(''); setPin(null); setOnset(manilaNow()); setShowForm(false) }
  }

  return <div className="dispatch-page disaster-events-page">
    <section className="panel dispatch-top">
      <div className="dispatch-head">
        <div><h3>Alarms</h3>
          <p className="dispatch-muted">Hazards reported from the app and the disasters they start. Pick one to see the details and its next step.</p></div>
        <button type="button" className="secondary-button" disabled={!register?.barangays.length || loading}
          onClick={() => { setShowForm(true); setNotice('') }}>Declare without a report</button>
      </div>
      <div className="op-counters" role="group" aria-label="Show only">
        {GROUPS.map((g) => <button key={g.key} type="button" className={`op-counter${groupFilter === g.key ? ' is-on' : ''}`}
          aria-pressed={groupFilter === g.key} onClick={() => setGroupFilter((f) => (f === g.key ? null : g.key))}>
          <strong className={g.key === 'waiting' && counts.waiting ? 'bad' : g.key === 'confirmed' && counts.confirmed ? 'warn' : ''}>{counts[g.key]}</strong>
          <span>{g.counter}</span></button>)}
      </div>
      {error && <p role="alert" className="dispatch-error">{error}</p>}
      {notice && <p role="status" className="dispatch-notice">{notice}</p>}
      {loading && <p role="status">Loading alarms…</p>}
    </section>

    {!loading && <div className="op-split">
      <section className="panel op-list" aria-label="Alarms">
        {groups.map((g) => {
          if (g.key === 'closed') return <div key={g.key}>
            <button type="button" className="op-group op-group-toggle" aria-expanded={showClosed} onClick={() => setClosedOpen((o) => !o)}>
              {g.title} ({g.list.length}) {showClosed ? '▾' : '▸'}</button>
            {showClosed && <ul>{g.list.map(renderRow)}</ul>}
          </div>
          if (!g.list.length && groupFilter !== g.key) return null
          return <div key={g.key}>
            <h4 className="op-group">{g.title} ({g.list.length})</h4>
            {g.list.length ? <ul>{g.list.map(renderRow)}</ul> : <p className="dispatch-muted op-empty">Nothing here right now.</p>}
          </div>
        })}
        {!items.length && <p className="dispatch-muted op-empty">No hazard reports or disasters right now.</p>}
      </section>
      <section id="alarm-detail" className="panel op-detail" aria-live="polite">
        {selected?.kind === 'hazard' ? renderHazard(selected.h)
          : selected?.kind === 'event' ? renderEvent(selected.ev)
          : <p className="dispatch-muted op-empty">Pick an alarm on the left to see its details.</p>}
      </section>
    </div>}

    {showForm && <SidePanel title="Declare a disaster without a report" busy={busy} error={error} onClose={() => setShowForm(false)}>
      <p className="disaster-hint">Use this when you know about the hazard from outside the app (for example PAGASA or a phone call). Residents of the barangay see it in the app. All times are Philippine time.</p>
      <form onSubmit={submit}>
        <fieldset disabled={!register || busy || !register.barangays.length} className="disaster-form">
          <label className="disaster-wide">Event name<input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Riverside flood, October 14" /></label>
          <label>Hazard<select value={hazard} onChange={(e) => setHazard(e.target.value as HazardType)}>{Object.entries(hazardLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label>Barangay<select required value={barangay || register?.barangays[0]?.barangay_id || ''} onChange={(e) => setBarangay(e.target.value)}>{register?.barangays.map((s) => <option key={s.barangay_id} value={s.barangay_id}>{s.barangay_name}</option>)}</select></label>
          <label className="disaster-wide">Incident onset (Philippine time)<input required type="datetime-local" value={onset} onChange={(e) => setOnset(e.target.value)} /></label>
          <label className="disaster-wide">Affected location / landmark<input required maxLength={500} value={location} onChange={(e) => setLocation(e.target.value)} /></label>
          <div className="disaster-wide">
            <p className="disaster-map-label">Location on the map (optional)</p>
            <DisasterAreaPicker barangayId={Number(barangay || register?.barangays[0]?.barangay_id) || null} latitude={pin?.lat ?? null} longitude={pin?.lng ?? null} disabled={!register || busy}
              onChange={(lat, lng) => setPin(lat !== null && lng !== null ? { lat, lng } : null)} />
          </div>
          <label className="disaster-wide">Situation notes / source (optional)<textarea maxLength={2000} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
          <div className="disaster-wide disaster-form-actions"><button className="hazard-declare-button" type="submit">{busy ? 'Saving…' : 'Declare disaster'}</button>
            <button type="button" className="secondary-button" disabled={busy} onClick={() => setShowForm(false)}>Cancel</button></div>
        </fieldset>
      </form>
    </SidePanel>}
  </div>
}
