import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  assignDispatchTicket, cancelOpenDispatchTicket, createDispatchTicket, getDispatchBoard, getDispatchTicketHistory,
  saveRescueUnit, updateDispatchStatus,
} from '../api/dispatchApi'
import type { Resident } from '../types/dashboard'
import { useEquipmentRules } from '../api/equipmentRulesApi'
import { EquipmentRulesPanel } from '../components/EquipmentRulesPanel'
import { vpiToday } from '../utils/vpi'
import {
  columnOf, elapsed, EQUIPMENT_OPTIONS, nextStatus, PRIORITY_LABELS, rankUnits, SOURCE_LABELS, STATUS_LABELS,
  suggestForResident, ticketLabel,
} from '../utils/dispatch'
import type { BoardColumn, DispatchBoard, DispatchTicket, RescueUnit, TicketPriority, TicketSource } from '../utils/dispatch'
import './DispatchPage.css'

type Draft = {
  sitio: string; event: string; resident: string; subject: string; source: TicketSource; sourceRef: string | null
  sosLevel: number | null; priority: TicketPriority; lat: string; lng: string; locationNote: string
  instructions: string; equipment: string[]; unit: string
}
type Action = { ticketId: string; kind: 'cancel' | 'resolve' | 'reassign' | 'assign'; note: string; unit: string } | null
type UnitDraft = { unitId: number | null; name: string; sitio: string; capabilities: string[]; extraCap: string; members: string[]; active: boolean }

const COLUMNS: { key: BoardColumn; title: string }[] = [
  { key: 'open', title: 'Unassigned' }, { key: 'assigned', title: 'Assigned' },
  { key: 'active', title: 'In progress' }, { key: 'closed', title: 'Closed (7 days)' },
]
const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }) : ''

export function DispatchPage({ residents }: { residents: Resident[] }) {
  const [board, setBoard] = useState<DispatchBoard | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [tab, setTab] = useState<'board' | 'units' | 'rules'>('board')
  const { rules: equipmentRules } = useEquipmentRules()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [action, setAction] = useState<Action>(null)
  const [history, setHistory] = useState<{ ticketId: string; rows: Awaited<ReturnType<typeof getDispatchTicketHistory>> } | null>(null)
  const [unitDraft, setUnitDraft] = useState<UnitDraft | null>(null)

  async function load() {
    setLoading(true); setError('')
    try { setBoard(await getDispatchBoard()) }
    catch (e) { setBoard(null); setError(e instanceof Error ? e.message : 'Unable to load the dispatch board.') }
    finally { setLoading(false) }
  }
  useEffect(() => {
    let cancelled = false
    getDispatchBoard().then(b => { if (!cancelled) setBoard(b) })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Unable to load the dispatch board.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  async function run(work: () => Promise<unknown>, done: string) {
    setBusy(true); setError(''); setNotice('')
    try { await work(); setNotice(done); setAction(null); await load() }
    catch (e) { setError(e instanceof Error ? e.message : 'Action failed.') }
    finally { setBusy(false) }
  }

  const residentById = useMemo(() => new Map(residents.map(r => [String(r.id), r])), [residents])
  const sitioName = (id: number | null) => id === null ? 'Barangay-wide' : board?.sitios.find(s => s.sitio_id === id)?.sitio_name ?? `Sitio ${id}`
  const unitById = (id: number | null) => board?.units.find(u => u.unit_id === id)

  // ---------------------------------------------------------------- ticket form
  function openDraft(seed: Partial<Draft> = {}) {
    const sitio = seed.sitio ?? String(board?.sitios[0]?.sitio_id ?? '')
    const resident = seed.resident ? residentById.get(seed.resident) : undefined
    const s = suggestForResident(resident, seed.sosLevel ?? null, vpiToday(), equipmentRules)
    setDraft({
      sitio, event: '', resident: '', subject: '', source: 'manual', sourceRef: null, sosLevel: null,
      priority: s.priority, lat: resident?.gpsLat != null ? String(resident.gpsLat) : '', lng: resident?.gpsLong != null ? String(resident.gpsLong) : '',
      locationNote: resident?.landmark && resident.landmark !== 'No landmark provided' ? resident.landmark : '',
      instructions: '', equipment: s.equipment, unit: '', ...seed,
    })
    setTab('board')
    window.scrollTo?.({ top: 0, behavior: 'smooth' })
  }
  function pickResident(uid: string) {
    if (!draft) return
    const r = residentById.get(uid)
    const s = suggestForResident(r, draft.sosLevel, vpiToday(), equipmentRules)
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
      sitioId: Number(draft.sitio), eventId: draft.event || null, residentUid: draft.resident || null, subject: draft.subject,
      source: draft.source, sourceRef: draft.sourceRef, priority: draft.priority, latitude: lat, longitude: lng,
      locationNote: draft.locationNote, instructions: draft.instructions, equipment: draft.equipment, unitId: draft.unit ? Number(draft.unit) : null,
    }).then(() => setDraft(null)), draft.unit ? 'Ticket issued and assigned.' : 'Ticket issued. Assign a unit from the board.')
  }

  // ---------------------------------------------------------------- units
  function editUnit(u: RescueUnit | null) {
    setUnitDraft(u ? { unitId: u.unit_id, name: u.unit_name, sitio: u.sitio_id === null ? '' : String(u.sitio_id),
      capabilities: u.capabilities, extraCap: '', members: u.member_uids, active: u.is_active }
      : { unitId: null, name: '', sitio: board?.is_super_admin ? '' : String(board?.sitios[0]?.sitio_id ?? ''), capabilities: [], extraCap: '', members: [], active: true })
  }
  async function submitUnit(e: FormEvent) {
    e.preventDefault()
    if (!unitDraft) return
    const caps = [...unitDraft.capabilities, ...unitDraft.extraCap.split(',').map(s => s.trim()).filter(Boolean)]
    await run(() => saveRescueUnit({ unitId: unitDraft.unitId, name: unitDraft.name, sitioId: unitDraft.sitio ? Number(unitDraft.sitio) : null,
      capabilities: caps, memberUids: unitDraft.members, active: unitDraft.active }).then(() => setUnitDraft(null)), 'Unit saved.')
  }

  const tickets = board?.tickets ?? []
  const live = tickets.filter(t => columnOf(t.status) !== 'closed')
  const intakeCount = (board?.intake_sos.length ?? 0) + (board?.intake_missing.length ?? 0)
  const draftResidents = draft ? residents.filter(r => !draft.sitio || sitioName(Number(draft.sitio)) === r.sitio || board?.sitios.length === 1) : []
  const ranked = draft ? rankUnits(board?.units ?? [], draft.equipment) : []
  const draftSuggestion = draft ? suggestForResident(residentById.get(draft.resident), draft.sosLevel, vpiToday(), equipmentRules) : null

  // A render helper, not a nested component, so typing in a ticket's note box keeps focus.
  function renderTicket(t: DispatchTicket) {
    const unit = unitById(t.assigned_unit_id)
    const resident = t.resident_uid ? residentById.get(t.resident_uid) : undefined
    const next = nextStatus(t.status)
    const mine = action?.ticketId === t.ticket_id ? action : null
    const closed = columnOf(t.status) === 'closed'
    const unitOptions = rankUnits(board?.units ?? [], t.equipment).filter(r => r.unit.unit_id !== t.assigned_unit_id)
    return <article key={t.ticket_id} className={`ticket-card prio-${t.priority}${closed ? ' closed' : ''}`}>
      <div className="ticket-head">
        <strong>{ticketLabel(t)}</strong>
        <span className={`prio-badge prio-${t.priority}`}>{PRIORITY_LABELS[t.priority]}</span>
        <span className={`status-badge st-${t.status}`}>{STATUS_LABELS[t.status]}</span>
      </div>
      <h4>{t.subject}</h4>
      <p className="dispatch-muted">{SOURCE_LABELS[t.source]} · {sitioName(t.sitio_id)} · opened {elapsed(t.created_at)} ago{t.created_by_name ? ` by ${t.created_by_name}` : ''}</p>
      {resident && <p className="dispatch-muted">Resident: {resident.name}{resident.mobilityStatus ? ` · ${resident.mobilityStatus.replace('_', '-')}` : ''}</p>}
      {(t.latitude !== null || t.location_note) && <p className="dispatch-muted">📍 {t.location_note}{t.location_note && t.latitude !== null ? ' · ' : ''}
        {t.latitude !== null && <a href={`https://www.openstreetmap.org/?mlat=${t.latitude}&mlon=${t.longitude}#map=18/${t.latitude}/${t.longitude}`} target="_blank" rel="noreferrer">{Number(t.latitude).toFixed(5)}, {Number(t.longitude).toFixed(5)}</a>}</p>}
      {t.equipment.length > 0 && <p className="ticket-equip">{t.equipment.map(e => <span key={e}>{e}</span>)}</p>}
      {t.instructions && <p className="ticket-instr">{t.instructions}</p>}
      {unit && <p className="dispatch-muted">Unit: <strong>{unit.unit_name}</strong>{unit.members.length ? ` — ${unit.members.map(m => m.name).join(', ')}` : ' — no members'}{t.assigned_at ? ` · assigned ${elapsed(t.assigned_at)} ago` : ''}</p>}
      {closed && t.outcome_note && <p className="ticket-outcome">{t.status === 'resolved' ? 'Outcome' : 'Cancelled'}: {t.outcome_note} · {fmt(t.closed_at)}</p>}

      {!closed && !mine && <div className="ticket-actions">
        {t.status === 'open'
          ? <button type="button" className="verify-button" disabled={busy || !unitOptions.length} onClick={() => setAction({ ticketId: t.ticket_id, kind: 'assign', note: '', unit: String(unitOptions[0]?.unit.unit_id ?? '') })}>Assign unit</button>
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
        if (mine.kind === 'assign' || mine.kind === 'reassign') void run(() => assignDispatchTicket(t.ticket_id, Number(mine.unit), mine.note), `${ticketLabel(t)} assigned to ${unitById(Number(mine.unit))?.unit_name}.`)
        else if (mine.kind === 'resolve') void run(() => updateDispatchStatus(t.ticket_id, 'resolved', mine.note), `${ticketLabel(t)} resolved.`)
        else if (t.status === 'open') void run(() => cancelOpenDispatchTicket(t.ticket_id, mine.note), `${ticketLabel(t)} cancelled.`)
        else void run(() => updateDispatchStatus(t.ticket_id, 'cancelled', mine.note), `${ticketLabel(t)} cancelled.`)
      }}>
        {(mine.kind === 'assign' || mine.kind === 'reassign') && <label>Responder unit
          <select value={mine.unit} onChange={e => setAction({ ...mine, unit: e.target.value })}>
            {unitOptions.map(r => <option key={r.unit.unit_id} value={r.unit.unit_id}>
              {r.unit.unit_name} · {r.unit.live_tickets} live{t.equipment.length ? ` · has ${r.covered}/${t.equipment.length} equipment` : ''}{r.unit.members.length ? '' : ' · no members'}</option>)}
          </select></label>}
        <label>{mine.kind === 'resolve' ? 'Outcome (required)' : mine.kind === 'cancel' ? 'Reason (required)' : mine.kind === 'reassign' && t.status !== 'assigned' ? 'Reason for reassigning (required)' : 'Note (optional)'}
          <textarea rows={2} maxLength={1000} value={mine.note} onChange={e => setAction({ ...mine, note: e.target.value })}
            required={mine.kind !== 'assign' && !(mine.kind === 'reassign' && t.status === 'assigned')} /></label>
        <div className="ticket-actions">
          <button type="submit" className="verify-button" disabled={busy}>{busy ? 'Saving…' : 'Confirm'}</button>
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
        <div><h3>Rescue dispatch</h3>
          <p className="dispatch-muted">Issue digital rescue tickets and assign them to responder units. Units update progress from the app; you can also update it here.</p></div>
        <div className="dispatch-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'board'} onClick={() => setTab('board')}>Board</button>
          <button type="button" role="tab" aria-selected={tab === 'units'} onClick={() => setTab('units')}>Units ({board?.units.filter(u => u.is_active).length ?? 0})</button>
          <button type="button" role="tab" aria-selected={tab === 'rules'} onClick={() => setTab('rules')}>Equipment rules</button>
        </div>
      </div>
      {board && <div className="dispatch-stats">
        <article><span>Needs a ticket</span><strong className={intakeCount ? 'warn' : ''}>{intakeCount}</strong></article>
        <article><span>Unassigned</span><strong className={live.some(t => t.status === 'open') ? 'bad' : ''}>{live.filter(t => t.status === 'open').length}</strong></article>
        <article><span>Critical live</span><strong className={live.some(t => t.priority === 'critical') ? 'bad' : ''}>{live.filter(t => t.priority === 'critical').length}</strong></article>
        <article><span>In progress</span><strong>{live.filter(t => columnOf(t.status) === 'active').length}</strong></article>
        <article><span>Idle active units</span><strong>{board.units.filter(u => u.is_active && u.live_tickets === 0).length}</strong></article>
      </div>}
      <div className="ticket-actions">
        <button type="button" className="primary-button" disabled={!board || busy} onClick={() => openDraft()}>New ticket</button>
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
            <label>Sitio<select value={draft.sitio} disabled={draft.source !== 'manual'} onChange={e => setDraft({ ...draft, sitio: e.target.value, resident: '', event: '' })}>
              {board.sitios.map(s => <option key={s.sitio_id} value={s.sitio_id}>{s.sitio_name}</option>)}</select></label>
            <label>Disaster event (optional)<select value={draft.event} onChange={e => setDraft({ ...draft, event: e.target.value })}>
              <option value="">None</option>{board.events.filter(ev => String(ev.sitio_id) === draft.sitio).map(ev => <option key={ev.event_id} value={ev.event_id}>{ev.name}</option>)}</select></label>
            <label className="wide">Resident (optional)<select value={draft.resident} disabled={draft.source === 'sos'} onChange={e => pickResident(e.target.value)}>
              <option value="">No specific resident</option>{draftResidents.map(r => <option key={r.id} value={r.id}>{r.name}{r.mobilityStatus ? ` · ${r.mobilityStatus.replace('_', '-')}` : ''}</option>)}</select></label>
            <label className="wide">What is needed<input required maxLength={200} value={draft.subject} onChange={e => setDraft({ ...draft, subject: e.target.value })} placeholder="e.g. Evacuate bedridden elder, Purok 2" /></label>
            <label>Priority<select value={draft.priority} onChange={e => setDraft({ ...draft, priority: e.target.value as TicketPriority })}>
              {(['critical', 'high', 'normal'] as const).map(p => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}</select>
              {draftSuggestion && draftSuggestion.reasons.length > 0 && <small className="dispatch-muted">Suggested {PRIORITY_LABELS[draftSuggestion.priority]}: {draftSuggestion.reasons.join(', ')}</small>}</label>
            <label>Assign to unit (optional)<select value={draft.unit} onChange={e => setDraft({ ...draft, unit: e.target.value })}>
              <option value="">Leave unassigned</option>
              {ranked.map(r => <option key={r.unit.unit_id} value={r.unit.unit_id}>{r.unit.unit_name} · {r.unit.live_tickets} live{draft.equipment.length ? ` · has ${r.covered}/${draft.equipment.length}` : ''}</option>)}</select></label>
            <label>Latitude<input inputMode="decimal" value={draft.lat} onChange={e => setDraft({ ...draft, lat: e.target.value })} /></label>
            <label>Longitude<input inputMode="decimal" value={draft.lng} onChange={e => setDraft({ ...draft, lng: e.target.value })} /></label>
            <label className="wide">Location / landmark<input maxLength={500} value={draft.locationNote} onChange={e => setDraft({ ...draft, locationNote: e.target.value })} /></label>
            <div className="wide"><span className="dispatch-label">Equipment to bring</span>
              <div className="dispatch-checks">{[...new Set([...EQUIPMENT_OPTIONS, ...draft.equipment])].map(eq => <label key={eq} className="dispatch-chip">
                <input type="checkbox" checked={draft.equipment.includes(eq)} onChange={e => setDraft({ ...draft, equipment: e.target.checked ? [...draft.equipment, eq] : draft.equipment.filter(x => x !== eq) })} />{eq}</label>)}</div>
              {draftSuggestion && draftSuggestion.equipmentReasons.length > 0 && <ul className="equip-reasons">
                {draftSuggestion.equipmentReasons.map(n => <li key={n.equipment}><strong>{n.equipment}</strong> — {n.reasons.join('; ')}</li>)}</ul>}
              <small className="dispatch-muted">Pre-filled from the resident's profile using the equipment rules (mobility, disabilities, pregnancy, age, assistance needs, household dependents). Trained personnel confirm what is appropriate.</small></div>
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
          {board.intake_sos.map(a => <article key={a.alert_id} className="intake-item">
            <div><span className="prio-badge prio-critical">SOS {a.alert_level ?? ''}</span> <strong>{a.resident_name}</strong>
              <div className="dispatch-muted">{a.alert_type ?? 'alert'} · {sitioName(a.sitio_id)} · {elapsed(a.created_at)} ago</div></div>
            <button type="button" className="verify-button" disabled={busy} onClick={() => openDraft({ sitio: String(a.sitio_id), resident: a.resident_uid, source: 'sos', sourceRef: a.alert_id,
              sosLevel: a.alert_level, subject: `SOS: ${a.alert_type ?? 'assistance'} — ${a.resident_name}`,
              lat: a.latitude != null ? String(a.latitude) : '', lng: a.longitude != null ? String(a.longitude) : '' })}>Create ticket</button>
          </article>)}
          {board.intake_missing.map(m => <article key={m.report_id} className="intake-item">
            <div><span className="prio-badge prio-high">Missing</span> <strong>{m.full_name}</strong>
              <div className="dispatch-muted">{m.last_seen_location || 'last seen unknown'} · {sitioName(m.sitio_id)} · reported {elapsed(m.reported_at)} ago</div></div>
            <button type="button" className="verify-button" disabled={busy} onClick={() => openDraft({ sitio: String(m.sitio_id), resident: m.resident_uid ?? '', source: 'missing_report', sourceRef: m.report_id,
              subject: `Search: ${m.full_name}`, priority: 'high', locationNote: m.last_seen_location,
              lat: m.latitude != null ? String(m.latitude) : '', lng: m.longitude != null ? String(m.longitude) : '' })}>Create ticket</button>
          </article>)}
        </div>
      </section>}

      <section className="dispatch-board">
        {COLUMNS.map(col => {
          const list = tickets.filter(t => columnOf(t.status) === col.key)
          return <div key={col.key} className={`dispatch-col col-${col.key}`}>
            <h3>{col.title} <span>{list.length}</span></h3>
            {!list.length && <p className="dispatch-muted">None.</p>}
            {list.map(t => renderTicket(t))}
          </div>
        })}
      </section>
    </>}

    {tab === 'rules' && <EquipmentRulesPanel />}

    {board && tab === 'units' && <section className="panel">
      <div className="dispatch-head"><h3>Responder units</h3>
        <button type="button" className="primary-button" disabled={busy} onClick={() => editUnit(null)}>New unit</button></div>
      <p className="dispatch-muted">Any active unit can be assigned to any ticket. Sitio admins manage their sitio's units; barangay-wide units are managed by a super admin. Members are rescuer accounts — they will see their unit's tickets in the app.</p>
      {unitDraft && <form className="unit-form" onSubmit={e => void submitUnit(e)}>
        <fieldset className="dispatch-form" disabled={busy}>
          <label>Unit name<input required maxLength={80} value={unitDraft.name} onChange={e => setUnitDraft({ ...unitDraft, name: e.target.value })} placeholder="e.g. Alpha Team" /></label>
          <label>Home sitio<select value={unitDraft.sitio} onChange={e => setUnitDraft({ ...unitDraft, sitio: e.target.value })}>
            {board.is_super_admin && <option value="">Barangay-wide</option>}
            {board.sitios.map(s => <option key={s.sitio_id} value={s.sitio_id}>{s.sitio_name}</option>)}</select></label>
          <div className="wide"><span className="dispatch-label">Capabilities / equipment carried</span>
            <div className="dispatch-checks">{[...new Set([...EQUIPMENT_OPTIONS, ...unitDraft.capabilities])].map(c => <label key={c} className="dispatch-chip">
              <input type="checkbox" checked={unitDraft.capabilities.includes(c)} onChange={e => setUnitDraft({ ...unitDraft, capabilities: e.target.checked ? [...unitDraft.capabilities, c] : unitDraft.capabilities.filter(x => x !== c) })} />{c}</label>)}</div>
            <input className="unit-extra" placeholder="Other (comma-separated), e.g. Chainsaw, Medic" value={unitDraft.extraCap} onChange={e => setUnitDraft({ ...unitDraft, extraCap: e.target.value })} /></div>
          <div className="wide"><span className="dispatch-label">Members (rescuer accounts)</span>
            {!board.rescuers.length && <p className="dispatch-muted">No active rescuer accounts yet.</p>}
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
        {board.units.map(u => <article key={u.unit_id} className={`unit-card${u.is_active ? '' : ' inactive'}`}>
          <div className="ticket-head"><strong>{u.unit_name}</strong><span className={`status-badge ${u.is_active ? (u.live_tickets ? 'st-en_route' : 'st-resolved') : 'st-cancelled'}`}>
            {u.is_active ? (u.live_tickets ? `${u.live_tickets} live ticket${u.live_tickets === 1 ? '' : 's'}` : 'Available') : 'Inactive'}</span></div>
          <p className="dispatch-muted">{sitioName(u.sitio_id)}</p>
          {u.capabilities.length > 0 && <p className="ticket-equip">{u.capabilities.map(c => <span key={c}>{c}</span>)}</p>}
          <p className="dispatch-muted">{u.members.length ? u.members.map(m => `${m.name}${m.contact_no ? ` (${m.contact_no})` : ''}`).join(', ') : 'No members yet'}</p>
          {u.editable && <button type="button" className="secondary-button" disabled={busy} onClick={() => editUnit(u)}>Edit</button>}
        </article>)}
        {!board.units.length && <p className="dispatch-muted">No units yet. Create one to start assigning tickets.</p>}
      </div>
    </section>}
  </div>
}
