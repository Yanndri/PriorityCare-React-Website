import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { getUnverifiedResidents, getSosNotes, getSosWithMembers,
  assignDispatchTicket, cancelOpenDispatchTicket, createDispatchTicket, getDispatchBoard, getDispatchTicketHistory,
  saveRescueUnit, updateDispatchStatus,
  getBackupRequests, closeBackupRequest, requestTeam, BACKUP_NEED_LABELS, type BackupRequest,
} from '../api/dispatchApi'
import type { Resident } from '../types/dashboard'
import { useShowOnMap } from '../lib/showOnMap'
import { vpiToday } from '../utils/vpi'
import { residentOnScene } from '../utils/householdVpi'
import {
  columnOf, elapsed, EQUIPMENT_OPTIONS, nextStatus, PRIORITY_LABELS, rankUnits, SOURCE_LABELS, STATUS_LABELS,
  suggestForResident, ticketLabel,
} from '../utils/dispatch'
import type { BoardColumn, DispatchBoard, DispatchTicket, RescueUnit, TicketPriority, TicketSource } from '../utils/dispatch'
import './DispatchPage.css'
import { Icon } from '../components/Icon'
import { useLiveSignal } from '../lib/useLiveSignal'
import { useScopeBarangay } from '../lib/scope'
import { TicketLocationMap } from '../components/TicketLocationMap'
import { SosResidentCard } from '../components/SosResidentCard'
import { isInCordova, useBarangayBorders } from '../utils/barangayBorders'

type Draft = {
  barangay: string; event: string; resident: string; subject: string; source: TicketSource; sourceRef: string | null
  sosLevel: number | null; priority: TicketPriority; lat: string; lng: string; locationNote: string
  instructions: string; equipment: string[]; unit: string
  sosNote?: string
  sosHeadcount?: number | null
  visitingFrom?: string | null
  sentFrom?: string | null
  withMembers?: string[] | null
}
type Action = { ticketId: string; kind: 'cancel' | 'resolve' | 'reassign' | 'assign' | 'askTeam'; note: string; unit: string } | null
type UnitDraft = { unitId: number | null; name: string; barangay: string; capabilities: string[]; extraCap: string; members: string[]; active: boolean }

const COLUMNS: { key: BoardColumn; title: string }[] = [
  { key: 'open', title: 'Unassigned' }, { key: 'assigned', title: 'Assigned' },
  { key: 'active', title: 'In progress' }, { key: 'closed', title: 'Closed (7 days)' },
]
// A short two-tone chime for a new SOS. Browsers allow it only after the page was clicked once.
function chime() {
  try {
    const ctx = new AudioContext()
    ;[880, 660].forEach((freq, i) => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain()
      osc.frequency.value = freq; gain.gain.value = 0.15
      osc.connect(gain); gain.connect(ctx.destination)
      osc.start(ctx.currentTime + i * 0.25); osc.stop(ctx.currentTime + i * 0.25 + 0.2)
    })
    setTimeout(() => void ctx.close(), 1000)
  } catch { /* no audio available */ }
}
const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }) : ''

// view: 'board' = rescue requests (Operation page), 'units' = Responder teams page.
export function DispatchPage({ residents, onOpenMissing, view = 'board' }: { residents: Resident[]; onOpenMissing?: () => void; view?: 'board' | 'units' }) {
  const [rawBoard, setBoard] = useState<DispatchBoard | null>(null)
  // Only the barangay chosen in the Scope selector (all of them for "All barangays").
  // Units stay listed: a unit from another barangay can still be sent (mutual aid).
  const scope = useScopeBarangay()
  const showOnMap = useShowOnMap()
  // An SOS sent from outside Cordova: the system still records it; the admin calls that town's MDRRMO.
  const borders = useBarangayBorders()
  const outsideCordova = (lat: unknown, lng: unknown) => {
    if (lat == null || lng == null || lat === '' || lng === '') return false
    const a = Number(lat), b = Number(lng)
    return Number.isFinite(a) && Number.isFinite(b) && !isInCordova(a, b, borders)
  }
  const board = useMemo(() => (rawBoard && scope != null ? {
    ...rawBoard,
    barangays: rawBoard.barangays.filter((b) => b.barangay_id === scope),
    events: rawBoard.events.filter((e) => e.barangay_id === scope),
    tickets: rawBoard.tickets.filter((t) => t.barangay_id === scope),
    intake_sos: rawBoard.intake_sos.filter((a) => a.barangay_id === scope),
    away_sos: (rawBoard.away_sos ?? []).filter((a) => a.barangay_id === scope),
    intake_missing: rawBoard.intake_missing.filter((m) => m.barangay_id === scope),
  } : rawBoard), [rawBoard, scope])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const tab = view
  const [draft, setDraft] = useState<Draft | null>(null)
  const [action, setAction] = useState<Action>(null)
  const [history, setHistory] = useState<{ ticketId: string; rows: Awaited<ReturnType<typeof getDispatchTicketHistory>> } | null>(null)
  const [unitDraft, setUnitDraft] = useState<UnitDraft | null>(null)
  const [backups, setBackups] = useState<BackupRequest[]>([])
  const loadBackups = () => getBackupRequests().then(setBackups).catch(() => setBackups([]))

  async function load() {
    setLoading(true); setError('')
    try { setBoard(await getDispatchBoard()) }
    catch (e) { setBoard(null); setError(e instanceof Error ? e.message : 'Unable to load the dispatch board.') }
    finally { setLoading(false) }
  }
  // New SOS calls since the page opened, highlighted until handled.
  const seenSos = useRef<Set<string> | null>(null)
  const [newSos, setNewSos] = useState<Set<string>>(new Set())
  const [unverified, setUnverified] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (!board) return
    let cancelled = false
    getUnverifiedResidents([...board.intake_sos, ...(board.away_sos ?? [])].map((a) => a.resident_uid ?? ''))
      .then((set) => { if (!cancelled) setUnverified(set) })
    return () => { cancelled = true }
  }, [board])
  // Resident SOS notes for tickets made from an SOS (the board itself only carries them for new SOS).
  const [sosNotes, setSosNotes] = useState<Map<string, string>>(new Map())
  useEffect(() => {
    if (!board) return
    let cancelled = false
    getSosNotes(board.tickets.filter((t) => t.source === 'sos' && t.source_ref).map((t) => t.source_ref ?? ''))
      .then((m) => { if (!cancelled) setSosNotes(m) })
    return () => { cancelled = true }
  }, [board])
  const notVerifiedTag = (uid?: string | null) => uid && unverified.has(uid)
    ? <> <span className="prio-badge prio-normal" title="The resident's account has not been verified by the barangay yet. Household details are self-reported.">Account not verified</span></> : null
  useEffect(() => {
    if (!board) return
    const ids = board.intake_sos.map(a => a.alert_id)
    if (seenSos.current) {
      const seen = seenSos.current
      const fresh = ids.filter(id => !seen.has(id))
      if (fresh.length) {
        setNewSos(prev => new Set([...prev, ...fresh]))
        const first = board.intake_sos.find(a => a.alert_id === fresh[0])
        setNotice(fresh.length === 1 ? `New SOS from ${first?.resident_name ?? 'a resident'}.` : `${fresh.length} new SOS calls.`)
        chime()
      }
    }
    seenSos.current = new Set(ids)
  }, [board])

  // Updates from the app (SOS raised or cancelled, rescuers moving tickets, units) without a Refresh.
  useLiveSignal(['sos', 'tickets', 'units', 'missing', 'events'], () => {
    getDispatchBoard().then(setBoard).catch(() => { /* keep the board shown; Refresh shows the error */ })
    void loadBackups()
  })

  useEffect(() => {
    let cancelled = false
    getDispatchBoard().then(b => { if (!cancelled) setBoard(b) })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Unable to load the dispatch board.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    getBackupRequests().then(b => { if (!cancelled) setBackups(b) }).catch(() => { /* STEP20 not run yet */ })
    return () => { cancelled = true }
  }, [])

  async function run(work: () => Promise<unknown>, done: string) {
    setBusy(true); setError(''); setNotice('')
    try { await work(); setNotice(done); setAction(null); await load(); await loadBackups() }
    catch (e) { setError(e instanceof Error ? e.message : 'Action failed.') }
    finally { setBusy(false) }
  }

  const residentById = useMemo(() => new Map(residents.map(r => [String(r.id), r])), [residents])
  const barangayName = (id: number | null) => id === null ? 'Barangay-wide' : board?.barangays.find(s => s.barangay_id === id)?.barangay_name ?? `Barangay ${id}`
  const unitById = (id: number | null) => board?.units.find(u => u.unit_id === id)

  // ---------------------------------------------------------------- ticket form
  function openDraft(seed: Partial<Draft> = {}) {
    const barangay = seed.barangay ?? String(board?.barangays[0]?.barangay_id ?? '')
    const resident = seed.resident ? residentById.get(seed.resident) : undefined
    const s = suggestForResident(residentOnScene(resident, seed.withMembers, !!seed.visitingFrom), seed.sosLevel ?? null, vpiToday())
    setDraft({
      barangay, event: '', resident: '', subject: '', source: 'manual', sourceRef: null, sosLevel: null,
      priority: s.priority, lat: resident?.gpsLat != null ? String(resident.gpsLat) : '', lng: resident?.gpsLong != null ? String(resident.gpsLong) : '',
      locationNote: resident?.landmark && resident.landmark !== 'No landmark provided' ? resident.landmark : '',
      instructions: '', equipment: s.equipment, unit: '', ...seed,
    })
    window.scrollTo?.({ top: 0, behavior: 'smooth' })
  }
  // Once the SOS's "who is with me" list loads, redo the priority and equipment for just those people.
  async function loadWithMembers(alertId: string) {
    const ids = await getSosWithMembers(alertId)
    if (!ids) return
    setDraft((d) => {
      if (!d || d.sourceRef !== alertId) return d
      const s = suggestForResident(residentOnScene(residentById.get(d.resident), ids, !!d.visitingFrom), d.sosLevel, vpiToday())
      return { ...d, withMembers: ids, priority: s.priority, equipment: s.equipment }
    })
  }
  function pickResident(uid: string) {
    if (!draft) return
    const r = residentById.get(uid)
    const s = suggestForResident(r, draft.sosLevel, vpiToday())
    setDraft({ ...draft, resident: uid, subject: draft.subject || (r ? `Assist ${r.name}` : ''), priority: s.priority,
      equipment: [...new Set([...draft.equipment, ...s.equipment])],
      lat: r?.gpsLat != null ? String(r.gpsLat) : draft.lat, lng: r?.gpsLong != null ? String(r.gpsLong) : draft.lng })
  }
  async function submitDraft(e: FormEvent) {
    e.preventDefault()
    if (!draft) return
    const lat = draft.lat.trim() ? Number(draft.lat) : null
    const lng = draft.lng.trim() ? Number(draft.lng) : null
    if ((lat === null) !== (lng === null) || (lat !== null && (!Number.isFinite(lat) || !Number.isFinite(lng!)))) { setError('Enter both coordinates as numbers, or leave both blank.'); return }
    await run(() => createDispatchTicket({
      barangayId: Number(draft.barangay), eventId: draft.event || null, residentUid: draft.resident || null, subject: draft.subject,
      source: draft.source, sourceRef: draft.sourceRef, priority: draft.priority, latitude: lat, longitude: lng,
      locationNote: draft.locationNote, instructions: draft.instructions, equipment: draft.equipment, unitId: draft.unit ? Number(draft.unit) : null,
    }).then(() => setDraft(null)), draft.unit ? 'Ticket issued and assigned.' : 'Ticket issued. Assign a unit from the board.')
  }

  // ---------------------------------------------------------------- units
  function editUnit(u: RescueUnit | null) {
    setUnitDraft(u ? { unitId: u.unit_id, name: u.unit_name, barangay: u.barangay_id === null ? '' : String(u.barangay_id),
      capabilities: u.capabilities, extraCap: '', members: u.member_uids, active: u.is_active }
      : { unitId: null, name: '', barangay: board?.is_super_admin ? '' : String(board?.barangays[0]?.barangay_id ?? ''), capabilities: [], extraCap: '', members: [], active: true })
  }
  async function submitUnit(e: FormEvent) {
    e.preventDefault()
    if (!unitDraft) return
    const caps = [...unitDraft.capabilities, ...unitDraft.extraCap.split(',').map(s => s.trim()).filter(Boolean)]
    await run(() => saveRescueUnit({ unitId: unitDraft.unitId, name: unitDraft.name, barangayId: unitDraft.barangay ? Number(unitDraft.barangay) : null,
      capabilities: caps, memberUids: unitDraft.members, active: unitDraft.active }).then(() => setUnitDraft(null)), 'Unit saved.')
  }

  const tickets = board?.tickets ?? []
  const live = tickets.filter(t => columnOf(t.status) !== 'closed')
  // Missing-person reports are handled on the Missing Persons page; only SOS calls wait here.
  const intakeCount = board?.intake_sos.length ?? 0
  const missingCount = board?.intake_missing.length ?? 0
  // The SOS sender is always listed, even when visiting another barangay.
  const draftResidents = draft ? residents.filter(r => String(r.id) === draft.resident || !draft.barangay || barangayName(Number(draft.barangay)) === r.barangay || board?.barangays.length === 1) : []
  // Only teams this admin may send: their own (the municipal admin: every team).
  const ownUnits = (board?.units ?? []).filter(u => !u.borrowed)
  const ranked = draft ? rankUnits(ownUnits, draft.equipment) : []
  const draftSuggestion = draft ? suggestForResident(residentOnScene(residentById.get(draft.resident), draft.withMembers, !!draft.visitingFrom), draft.sosLevel, vpiToday()) : null

  // A render helper, not a nested component, so typing in a ticket's note box keeps focus.
  function renderTicket(t: DispatchTicket) {
    const unit = unitById(t.assigned_unit_id)
    const resident = t.resident_uid ? residentById.get(t.resident_uid) : undefined
    const next = nextStatus(t.status)
    const mine = action?.ticketId === t.ticket_id ? action : null
    const closed = columnOf(t.status) === 'closed'
    const unitOptions = rankUnits(ownUnits, t.equipment).filter(r => r.unit.unit_id !== t.assigned_unit_id)
    const teamAsked = backups.find(b => b.ticket_id === t.ticket_id && b.need === 'team')
    const isSuper = !!board?.is_super_admin
    return <article key={t.ticket_id} className={`ticket-card prio-${t.priority}${closed ? ' closed' : ''}`}>
      <div className="ticket-head">
        <strong>{ticketLabel(t)}</strong>
        <span className={`prio-badge prio-${t.priority}`}>{PRIORITY_LABELS[t.priority]}</span>
        <span className={`status-badge st-${t.status}`}>{STATUS_LABELS[t.status]}</span>
      </div>
      <h4>{t.subject}</h4>
      {t.source === 'sos' && t.source_ref && sosNotes.get(t.source_ref) && <p className="sos-note"><strong>Resident says:</strong>{' '}
        "{sosNotes.get(t.source_ref)}"</p>}
      <p className="dispatch-muted">{SOURCE_LABELS[t.source]} · {barangayName(t.barangay_id)} · opened {elapsed(t.created_at)} ago{t.created_by_name ? ` by ${t.created_by_name}` : ''}</p>
      {resident && <p className="dispatch-muted">Resident: {resident.name}{resident.mobilityStatus ? ` · ${resident.mobilityStatus.replace('_', '-')}` : ''}</p>}
      {(t.latitude !== null || t.location_note) && <p className="dispatch-muted"><Icon name="marker" /> {t.location_note}{t.location_note && t.latitude !== null ? ' · ' : ''}
        {t.latitude !== null && (showOnMap ? <button type="button" className="link-button" onClick={() => showOnMap({ lat: Number(t.latitude), lng: Number(t.longitude), label: ticketLabel(t) })}>See on map</button> : null)}</p>}
      {t.equipment.length > 0 && <p className="ticket-equip">{t.equipment.map(e => <span key={e}>{e}</span>)}</p>}
      {t.instructions && <p className="ticket-instr">{t.instructions}</p>}
      {teamAsked && (isSuper
        ? <div className="ticket-backup" role="alert"><span><strong>{barangayName(t.barangay_id)} asks for a team</strong>
            {' '}· asked {elapsed(teamAsked.requested_at)} ago{teamAsked.requested_by_name ? ` by ${teamAsked.requested_by_name}` : ''}{teamAsked.note ? ` — ${teamAsked.note}` : ''}. Sending a team answers it.</span></div>
        : <div className="ticket-waiting" role="status"><span><strong>Waiting for a team from the municipality</strong> · asked {elapsed(teamAsked.requested_at)} ago</span>
            <button type="button" className="link-button" disabled={busy}
              onClick={() => void run(() => closeBackupRequest(teamAsked.request_id, 'cancel'), `Request for a team on ${ticketLabel(t)} taken back.`)}>Take back</button></div>)}
      {backups.filter(b => b.ticket_id === t.ticket_id && b.need !== 'team').map(b => <div key={b.request_id} className="ticket-backup" role="alert">
        <span><strong>Backup needed: {BACKUP_NEED_LABELS[b.need] ?? b.need}</strong>
          {' '}· asked {elapsed(b.requested_at)} ago{b.requested_by_name ? ` by ${b.requested_by_name}` : ''}{b.note ? ` — ${b.note}` : ''}</span>
        <button type="button" className="verify-button" disabled={busy}
          onClick={() => void run(() => closeBackupRequest(b.request_id, 'handled'), `Backup for ${ticketLabel(t)} marked as sent.`)}>Mark sent</button>
      </div>)}
      {unit && <p className="dispatch-muted">Team: <strong>{unit.unit_name}</strong>{unit.borrowed ? ' (sent by the municipality)' : unit.members.length ? ` — ${unit.members.map(m => m.name).join(', ')}` : ' — no members'}{t.assigned_at ? ` · assigned ${elapsed(t.assigned_at)} ago` : ''}</p>}
      {closed && t.outcome_note && <p className="ticket-outcome">{t.status === 'resolved' ? 'Outcome' : 'Canceled'}: {t.outcome_note} · {fmt(t.closed_at)}</p>}

      {!closed && !mine && <div className="ticket-actions">
        {t.status === 'open'
          ? <>
            <button type="button" className="verify-button" disabled={busy || !unitOptions.length} onClick={() => setAction({ ticketId: t.ticket_id, kind: 'assign', note: '', unit: String(unitOptions[0]?.unit.unit_id ?? '') })}>Assign unit</button>
            {!isSuper && !teamAsked && <button type="button" className="secondary-button" disabled={busy}
              onClick={() => setAction({ ticketId: t.ticket_id, kind: 'askTeam', note: '', unit: '' })}>Ask the municipality for a team</button>}
          </>
          : <>
            {next && <button type="button" className="secondary-button" disabled={busy} title="Normally updated by the unit from the app"
              onClick={() => void run(() => updateDispatchStatus(t.ticket_id, next, ''), `${ticketLabel(t)} marked ${STATUS_LABELS[next].toLowerCase()}.`)}>Mark {STATUS_LABELS[next].toLowerCase()}</button>}
            <button type="button" className="verify-button" disabled={busy} onClick={() => setAction({ ticketId: t.ticket_id, kind: 'resolve', note: '', unit: '' })}>Resolve…</button>
            <button type="button" className="secondary-button" disabled={busy || !unitOptions.length} onClick={() => setAction({ ticketId: t.ticket_id, kind: 'reassign', note: '', unit: String(unitOptions[0]?.unit.unit_id ?? '') })}>Reassign…</button>
          </>}
        <button type="button" className="secondary-button" disabled={busy} onClick={() => setAction({ ticketId: t.ticket_id, kind: 'cancel', note: '', unit: '' })}>Cancel…</button>
      </div>}

      {mine && <form className="ticket-action-form" onSubmit={e => {
        e.preventDefault()
        if (mine.kind === 'askTeam') void run(() => requestTeam(t.ticket_id, mine.note), `Asked the municipality for a team for ${ticketLabel(t)}.`)
        else if (mine.kind === 'assign' || mine.kind === 'reassign') void run(() => assignDispatchTicket(t.ticket_id, Number(mine.unit), mine.note), `${ticketLabel(t)} assigned to ${unitById(Number(mine.unit))?.unit_name}.`)
        else if (mine.kind === 'resolve') void run(() => updateDispatchStatus(t.ticket_id, 'resolved', mine.note), `${ticketLabel(t)} resolved.`)
        else if (t.status === 'open') void run(() => cancelOpenDispatchTicket(t.ticket_id, mine.note), `${ticketLabel(t)} cancelled.`)
        else void run(() => updateDispatchStatus(t.ticket_id, 'cancelled', mine.note), `${ticketLabel(t)} cancelled.`)
      }}>
        {(mine.kind === 'assign' || mine.kind === 'reassign') && <label>Responder unit
          <select value={mine.unit} onChange={e => setAction({ ...mine, unit: e.target.value })}>
            {unitOptions.map(r => <option key={r.unit.unit_id} value={r.unit.unit_id}>
              {r.unit.unit_name} · {r.unit.live_tickets} live{t.equipment.length ? ` · has ${r.covered}/${t.equipment.length} equipment` : ''}{r.unit.members.length ? '' : ' · no members'}</option>)}
          </select></label>}
        {mine.kind === 'askTeam' && <p className="dispatch-muted">The municipal admin sees this right away and sends a team from another barangay. You will see the team's name and progress here.</p>}
        <label>{mine.kind === 'askTeam' ? 'Note for the municipality (optional), e.g. "Our team is busy, 3 people, water rising"' : mine.kind === 'resolve' ? 'Outcome (required)' : mine.kind === 'cancel' ? 'Reason (required)' : mine.kind === 'reassign' && t.status !== 'assigned' ? 'Reason for reassigning (required)' : 'Note (optional)'}
          <textarea rows={2} maxLength={1000} value={mine.note} onChange={e => setAction({ ...mine, note: e.target.value })}
            required={mine.kind !== 'assign' && mine.kind !== 'askTeam' && !(mine.kind === 'reassign' && t.status === 'assigned')} /></label>
        <div className="ticket-actions">
          <button type="submit" className="verify-button" disabled={busy}>{busy ? 'Saving…' : mine.kind === 'askTeam' ? 'Send request' : 'Confirm'}</button>
          <button type="button" className="secondary-button" disabled={busy} onClick={() => setAction(null)}>Back</button>
        </div>
      </form>}

      <button type="button" className="ticket-history-toggle" onClick={async () => {
        if (history?.ticketId === t.ticket_id) { setHistory(null); return }
        try { setHistory({ ticketId: t.ticket_id, rows: await getDispatchTicketHistory(t.ticket_id) }) } catch (e) { setError(e instanceof Error ? e.message : 'History failed.') }
      }}>{history?.ticketId === t.ticket_id ? 'Hide history' : 'History'}</button>
      {history?.ticketId === t.ticket_id && <ol className="ticket-history">{history.rows.map((h, i) => <li key={i}>
        <span>{fmt(h.recorded_at)}</span> {h.action}{h.to_status ? ` → ${STATUS_LABELS[h.to_status as keyof typeof STATUS_LABELS] ?? h.to_status}` : ''}
        {h.unit_name ? ` (${h.unit_name})` : ''}{h.actor_name ? ` · ${h.actor_name}` : ''}{h.note ? ` — ${h.note}` : ''}</li>)}</ol>}
    </article>
  }

  return <div className="dispatch-page">
    <section className="panel dispatch-top">
      <div className="dispatch-head">
        <div><h3>{tab === 'units' ? 'Responder teams' : 'Rescue requests'}</h3>
          <p className="dispatch-muted">{tab === 'units'
            ? 'Teams that can be sent to a rescue request. Members see their team\'s rescues in the app.'
            : 'Turn each SOS into a rescue request and send a responder team. Teams update progress from the app; you can also update it here.'}</p></div>
      </div>
      {board && tab === 'board' && <div className="dispatch-stats">
        <article><span>Needs a ticket</span><strong className={intakeCount ? 'warn' : ''}>{intakeCount}</strong></article>
        <article><span>Backup asked</span><strong className={backups.length ? 'bad' : ''}>{backups.length}</strong></article>
        <article><span>Unassigned</span><strong className={live.some(t => t.status === 'open') ? 'bad' : ''}>{live.filter(t => t.status === 'open').length}</strong></article>
        <article><span>Assigned</span><strong>{live.filter(t => columnOf(t.status) === 'assigned').length}</strong></article>
        <article><span>Critical live</span><strong className={live.some(t => t.priority === 'critical') ? 'bad' : ''}>{live.filter(t => t.priority === 'critical').length}</strong></article>
        <article><span>In progress</span><strong>{live.filter(t => columnOf(t.status) === 'active').length}</strong></article>
        <article><span>Free teams</span><strong>{ownUnits.filter(u => u.is_active && u.live_tickets === 0).length}</strong></article>
      </div>}
      <div className="ticket-actions">
        {tab === 'board' && <button type="button" className="primary-button" disabled={!board || busy} onClick={() => openDraft()}>New ticket</button>}
        <button type="button" className="secondary-button" disabled={loading || busy} onClick={() => void load()}>Refresh</button>
      </div>
      {error && <p role="alert" className="dispatch-error">{error}</p>}
      {notice && <p role="status" className="dispatch-notice">{notice}</p>}
      {loading && <p role="status">Loading dispatch board…</p>}
    </section>

    {board && tab === 'board' && <>
      {draft && <section className="panel">
        <h3>New dispatch ticket{draft.source !== 'manual' ? ` — from ${SOURCE_LABELS[draft.source]}` : ''}</h3>
        <form onSubmit={e => void submitDraft(e)}>
          <fieldset className="dispatch-form" disabled={busy}>
            {draft.source === 'sos' && draft.resident && <SosResidentCard residentUid={draft.resident} resident={residentById.get(draft.resident)}
              headcount={draft.sosHeadcount} note={draft.sosNote} visitingFrom={draft.visitingFrom} sentFrom={draft.sentFrom} withMembers={draft.withMembers}
              outsideCordova={outsideCordova(draft.lat, draft.lng)} />}
            <label>Barangay<select value={draft.barangay} disabled={draft.source !== 'manual'} onChange={e => setDraft({ ...draft, barangay: e.target.value, resident: '', event: '' })}>
              {board.barangays.map(s => <option key={s.barangay_id} value={s.barangay_id}>{s.barangay_name}</option>)}</select></label>
            <label>Disaster event (optional)<select value={draft.event} onChange={e => setDraft({ ...draft, event: e.target.value })}>
              <option value="">None</option>{board.events.filter(ev => String(ev.barangay_id) === draft.barangay).map(ev => <option key={ev.event_id} value={ev.event_id}>{ev.name}</option>)}</select></label>
            {draft.source !== 'sos' && <label className="wide">Resident (optional)<select value={draft.resident} onChange={e => pickResident(e.target.value)}>
              <option value="">No specific resident</option>{draftResidents.map(r => <option key={r.id} value={r.id}>{r.name}{r.mobilityStatus ? ` · ${r.mobilityStatus.replace('_', '-')}` : ''}</option>)}</select></label>}
            {draft.source !== 'sos' && <label className="wide">What is needed<input required maxLength={200} value={draft.subject} onChange={e => setDraft({ ...draft, subject: e.target.value })} placeholder="e.g. Evacuate bedridden elder, Purok 2" /></label>}
            <label>Priority<select value={draft.priority} onChange={e => setDraft({ ...draft, priority: e.target.value as TicketPriority })}>
              {(['critical', 'high', 'normal'] as const).map(p => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}</select>
              {draftSuggestion && draftSuggestion.reasons.length > 0 && <small className="dispatch-muted">Suggested {PRIORITY_LABELS[draftSuggestion.priority]}: {draftSuggestion.reasons.join(', ')}</small>}</label>
            <label>Assign to unit (optional)<select value={draft.unit} onChange={e => setDraft({ ...draft, unit: e.target.value })}>
              <option value="">Leave unassigned</option>
              {ranked.map(r => <option key={r.unit.unit_id} value={r.unit.unit_id}>{r.unit.unit_name} · {r.unit.live_tickets} live{draft.equipment.length ? ` · has ${r.covered}/${draft.equipment.length}` : ''}</option>)}</select></label>
            <div className="wide"><span className="dispatch-label">Where to go</span>
              <TicketLocationMap latitude={draft.lat} longitude={draft.lng} fixed={draft.source === 'sos'}
                home={(() => { const r = residentById.get(draft.resident); const la = Number(r?.gpsLat), lo = Number(r?.gpsLong)
                  return r && r.gpsLat != null && Number.isFinite(la) && Number.isFinite(lo) && la !== 0 ? { lat: la, lng: lo } : null })()}
                onChange={(lat, lng) => setDraft((d) => (d ? { ...d, lat, lng } : d))} /></div>
            <label className="wide">Location / landmark<input maxLength={500} value={draft.locationNote} onChange={e => setDraft({ ...draft, locationNote: e.target.value })} /></label>
            <div className="wide"><span className="dispatch-label">Equipment to bring</span>
              <div className="dispatch-checks">{[...new Set([...EQUIPMENT_OPTIONS, ...draft.equipment])].map(eq => <label key={eq} className="dispatch-chip">
                <input type="checkbox" checked={draft.equipment.includes(eq)} onChange={e => setDraft({ ...draft, equipment: e.target.checked ? [...draft.equipment, eq] : draft.equipment.filter(x => x !== eq) })} />{eq}</label>)}</div>
              {draftSuggestion && draftSuggestion.equipmentReasons.length > 0 && <ul className="equip-reasons">
                {draftSuggestion.equipmentReasons.map(n => <li key={n.equipment}><strong>{n.equipment}</strong> — {n.reasons.join('; ')}</li>)}</ul>}
              <small className="dispatch-muted">Pre-filled from the resident's profile using the fixed equipment list (mobility, disabilities, pregnancy, age, assistance needs, household members). Responders confirm on site.</small></div>
            <label className="wide">Instructions for the unit<textarea rows={3} maxLength={2000} value={draft.instructions} onChange={e => setDraft({ ...draft, instructions: e.target.value })} /></label>
            <div className="wide ticket-actions">
              <button type="submit" className="primary-button">{busy ? 'Issuing…' : draft.unit ? 'Issue & assign' : 'Issue ticket'}</button>
              <button type="button" className="secondary-button" onClick={() => setDraft(null)}>Discard</button>
            </div>
          </fieldset>
        </form>
      </section>}

      {intakeCount > 0 && <section className="panel">
        <h3>Needs a ticket</h3>
        <div className="intake-list">
          {board.intake_sos.map(a => <article key={a.alert_id} className={`intake-item${newSos.has(a.alert_id) ? ' is-new' : ''}`}>
            <div>{newSos.has(a.alert_id) && <span className="new-badge">New</span>}<span className="prio-badge prio-critical">SOS {a.alert_level ?? ''}</span> <strong>{a.resident_name}</strong>{notVerifiedTag(a.resident_uid)}
              {outsideCordova(a.latitude, a.longitude) && <> <span className="prio-badge prio-high">Outside Cordova</span></>}
              {a.home_barangay_id != null && a.home_barangay_id !== a.barangay_id && <> <span className="prio-badge prio-normal">Visiting from {a.home_barangay_name ?? `Barangay ${a.home_barangay_id}`}</span></>}
              <div className="dispatch-muted">{a.alert_type ?? 'alert'} · {a.barangay_name ?? barangayName(a.barangay_id)}{a.headcount ? ` · ${a.headcount} ${a.headcount === 1 ? 'person' : 'people'}` : ''} · {elapsed(a.created_at)} ago</div>
              {a.note && <div className="sos-note"><strong>Resident says:</strong> "{a.note}"</div>}</div>
            <button type="button" className="verify-button" disabled={busy} onClick={() => { void loadWithMembers(a.alert_id); openDraft({ barangay: String(a.barangay_id), resident: a.resident_uid, source: 'sos', sourceRef: a.alert_id,
              sosLevel: a.alert_level, sosNote: a.note ?? '', sosHeadcount: a.headcount,
              visitingFrom: a.home_barangay_id != null && a.home_barangay_id !== a.barangay_id ? (a.home_barangay_name ?? `Barangay ${a.home_barangay_id}`) : null,
              sentFrom: a.barangay_name ?? barangayName(a.barangay_id), subject: `SOS: ${a.alert_type ?? 'assistance'} — ${a.resident_name}`,
              lat: a.latitude != null ? String(a.latitude) : '', lng: a.longitude != null ? String(a.longitude) : '' }) }}>Create ticket</button>
          </article>)}
        </div>
      </section>}

      {missingCount > 0 && <p className="dispatch-muted missing-hint">
        {missingCount} missing-person report{missingCount === 1 ? ' is' : 's are'} open on the{' '}
        {onOpenMissing ? <button type="button" className="link-button" onClick={onOpenMissing}>Missing persons tab</button> : 'Missing persons tab'}.
        To send a search team, use New ticket.</p>}

      {!!board.away_sos?.length && <section className="panel">
        <h3>Your residents in other barangays</h3>
        <p className="dispatch-muted">These residents raised an SOS outside your barangay, so that barangay dispatches it. Shown here so you can help with family contacts and household details.</p>
        <div className="intake-list">
          {board.away_sos.map(a => <article key={a.alert_id} className="intake-item">
            <div><span className="prio-badge prio-critical">SOS {a.alert_level ?? ''}</span> <strong>{a.resident_name}</strong>{notVerifiedTag(a.resident_uid)}
              <div className="dispatch-muted">{a.alert_type ?? 'alert'} · in {a.barangay_name}{a.headcount ? ` · ${a.headcount} ${a.headcount === 1 ? 'person' : 'people'}` : ''} · {elapsed(a.created_at)} ago</div></div>
            <span className={`status-badge st-${a.ticket_status ?? 'open'}`}>{a.ticket_status ? `${STATUS_LABELS[a.ticket_status]}${a.unit_name ? ` · ${a.unit_name}` : ''}` : 'Awaiting dispatch'}</span>
          </article>)}
        </div>
      </section>}

      <section className="dispatch-board">
        {COLUMNS.map(col => {
          const list = tickets.filter(t => columnOf(t.status) === col.key)
          return <div key={col.key} className={`dispatch-col col-${col.key}${list.length ? '' : ' is-empty'}`}>
            <h3>{col.title} <span>{list.length}</span></h3>
            {!list.length && <p className="dispatch-muted">Nothing here right now.</p>}
            {list.map(t => renderTicket(t))}
          </div>
        })}
      </section>

    </>}


    {board && tab === 'units' && <section className="panel">
      <div className="dispatch-head"><h3>Responder units</h3>
        <button type="button" className="primary-button" disabled={busy} onClick={() => editUnit(null)}>New unit</button></div>
      <p className="dispatch-muted">Each barangay sends only its own teams. When all of yours are busy, use "Ask the municipality for a team" on the rescue request; the municipal admin sends one from another barangay. Members are responder accounts assigned to your barangay; they see their team's rescues in the app.</p>
      {unitDraft && <form className="unit-form" onSubmit={e => void submitUnit(e)}>
        <fieldset className="dispatch-form" disabled={busy}>
          <label>Unit name<input required maxLength={80} value={unitDraft.name} onChange={e => setUnitDraft({ ...unitDraft, name: e.target.value })} placeholder="e.g. Alpha Team" /></label>
          <label>Home barangay<select value={unitDraft.barangay} onChange={e => setUnitDraft({ ...unitDraft, barangay: e.target.value })}>
            {board.is_super_admin && <option value="">Barangay-wide</option>}
            {board.barangays.map(s => <option key={s.barangay_id} value={s.barangay_id}>{s.barangay_name}</option>)}</select></label>
          <div className="wide"><span className="dispatch-label">Capabilities / equipment carried</span>
            <div className="dispatch-checks">{[...new Set([...EQUIPMENT_OPTIONS, ...unitDraft.capabilities])].map(c => <label key={c} className="dispatch-chip">
              <input type="checkbox" checked={unitDraft.capabilities.includes(c)} onChange={e => setUnitDraft({ ...unitDraft, capabilities: e.target.checked ? [...unitDraft.capabilities, c] : unitDraft.capabilities.filter(x => x !== c) })} />{c}</label>)}</div>
            <input className="unit-extra" placeholder="Other (comma-separated), e.g. Chainsaw, Medic" value={unitDraft.extraCap} onChange={e => setUnitDraft({ ...unitDraft, extraCap: e.target.value })} /></div>
          <div className="wide"><span className="dispatch-label">Members (responder accounts)</span>
            {!board.rescuers.length && <p className="dispatch-muted">No active responder accounts yet.</p>}
            <div className="dispatch-checks">{board.rescuers.map(r => <label key={r.uid} className="dispatch-chip">
              <input type="checkbox" checked={unitDraft.members.includes(r.uid)} onChange={e => setUnitDraft({ ...unitDraft, members: e.target.checked ? [...unitDraft.members, r.uid] : unitDraft.members.filter(x => x !== r.uid) })} />{r.name}</label>)}</div></div>
          <label className="dispatch-chip"><input type="checkbox" checked={unitDraft.active} onChange={e => setUnitDraft({ ...unitDraft, active: e.target.checked })} />Active (can be assigned)</label>
          <div className="wide ticket-actions">
            <button type="submit" className="primary-button">{busy ? 'Saving…' : 'Save unit'}</button>
            <button type="button" className="secondary-button" onClick={() => setUnitDraft(null)}>Cancel</button>
          </div>
        </fieldset>
      </form>}
      <div className="unit-grid">
        {ownUnits.map(u => <article key={u.unit_id} className={`unit-card${u.is_active ? '' : ' inactive'}`}>
          <div className="ticket-head"><strong>{u.unit_name}</strong><span className={`status-badge ${u.is_active ? (u.live_tickets ? 'st-en_route' : 'st-resolved') : 'st-cancelled'}`}>
            {u.is_active ? (u.live_tickets ? `${u.live_tickets} live ticket${u.live_tickets === 1 ? '' : 's'}` : 'Available') : 'Inactive'}</span></div>
          <p className="dispatch-muted">{barangayName(u.barangay_id)}</p>
          {u.capabilities.length > 0 && <p className="ticket-equip">{u.capabilities.map(c => <span key={c}>{c}</span>)}</p>}
          <p className="dispatch-muted">{u.members.length ? u.members.map(m => `${m.name}${m.contact_no ? ` (${m.contact_no})` : ''}`).join(', ') : 'No members yet'}</p>
          {u.editable && <button type="button" className="secondary-button" disabled={busy} onClick={() => editUnit(u)}>Edit</button>}
        </article>)}
        {!ownUnits.length && <p className="dispatch-muted">No units yet. Create one to start assigning tickets.</p>}
      </div>
    </section>}
  </div>
}
