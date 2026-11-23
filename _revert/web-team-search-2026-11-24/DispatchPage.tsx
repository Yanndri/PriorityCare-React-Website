import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
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
import type { DispatchBoard, DispatchTicket, IntakeSos, RescueUnit, TicketPriority, TicketSource, TicketStatus } from '../utils/dispatch'
import './DispatchPage.css'
import { useLiveSignal } from '../lib/useLiveSignal'
import { useScopeBarangay } from '../lib/scope'
import { TicketLocationMap } from '../components/TicketLocationMap'
import { SosResidentCard } from '../components/SosResidentCard'
import { SidePanel } from '../components/SidePanel'
import { MemberPicker } from '../components/MemberPicker'
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

// The Operation list: new SOS first, then tickets by their next step.
type Group = 'sos' | 'waiting' | 'moving' | 'closed'
type Item =
  | { kind: 'sos'; key: string; sos: IntakeSos; group: Group; priority: TicketPriority; at: string | null }
  | { kind: 'ticket'; key: string; t: DispatchTicket; group: Group; priority: TicketPriority; at: string | null }
const GROUPS: { key: Group; title: string }[] = [
  { key: 'sos', title: 'Needs a ticket' }, { key: 'waiting', title: 'Waiting for a team' },
  { key: 'moving', title: 'Team on the way' }, { key: 'closed', title: 'Closed (7 days)' },
]
// Team progress shown as "Step n/4" (the team updates it from the app).
const STEP: Partial<Record<TicketStatus, number>> = { assigned: 1, acknowledged: 2, en_route: 3, on_scene: 4 }
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
  // Operation list: selected row, search and filters.
  const [sel, setSel] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [brgyFilter, setBrgyFilter] = useState('')
  const [prioFilter, setPrioFilter] = useState<TicketPriority | ''>('')
  const [groupFilter, setGroupFilter] = useState<Group | 'backup' | null>(null)
  const [closedOpen, setClosedOpen] = useState(false)
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
      instructions: '', equipment: s.equipment,
      // Suggest the best free team of this admin's own; the admin can change it.
      unit: String(rankUnits(ownUnits, s.equipment).find(r => r.unit.live_tickets === 0)?.unit.unit_id ?? ''), ...seed,
    })
    setAction(null); setHistory(null)
    if (window.innerWidth < 1000) setTimeout(() => document.getElementById('op-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
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
    }).then((id) => { setDraft(null); if (id) setSel(`t:${id}`) }), draft.unit ? 'Ticket created and the team was sent.' : 'Ticket created. Press "Assign a team" to send one.')
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
  // Missing-person reports are handled on the Missing Persons page; only SOS calls wait here.
  const missingCount = board?.intake_missing.length ?? 0
  // The SOS sender is always listed, even when visiting another barangay.
  const draftResidents = draft ? residents.filter(r => String(r.id) === draft.resident || !draft.barangay || barangayName(Number(draft.barangay)) === r.barangay || board?.barangays.length === 1) : []
  // Only teams this admin may send: their own (the municipal admin: every team).
  const ownUnits = (board?.units ?? []).filter(u => !u.borrowed)
  const ranked = draft ? rankUnits(ownUnits, draft.equipment) : []
  const draftSuggestion = draft ? suggestForResident(residentOnScene(residentById.get(draft.resident), draft.withMembers, !!draft.visitingFrom), draft.sosLevel, vpiToday()) : null

  // ---------------------------------------------------------------- one list + one detail panel
  const isSuper = !!board?.is_super_admin
  const teamAskOf = (t: DispatchTicket) => backups.find(b => b.ticket_id === t.ticket_id && b.need === 'team')
  const otherBackupsOf = (t: DispatchTicket) => backups.filter(b => b.ticket_id === t.ticket_id && b.need !== 'team')
  const sosPriority = (a: IntakeSos): TicketPriority => (a.alert_level ?? 0) >= 3 ? 'critical' : 'high'
  const ticketName = (t: DispatchTicket) => (t.resident_uid ? residentById.get(t.resident_uid)?.name : '') || t.subject
  const groupOfTicket = (t: DispatchTicket): Group => t.status === 'open' ? 'waiting' : columnOf(t.status) === 'closed' ? 'closed' : 'moving'
  const items: Item[] = board ? [
    ...board.intake_sos.map((a): Item => ({ kind: 'sos', key: `sos:${a.alert_id}`, sos: a, group: 'sos', priority: sosPriority(a), at: a.created_at })),
    ...tickets.map((t): Item => ({ kind: 'ticket', key: `t:${t.ticket_id}`, t, group: groupOfTicket(t), priority: t.priority,
      at: columnOf(t.status) === 'closed' ? t.closed_at : t.created_at })),
  ] : []
  const counts: Record<Group, number> = { sos: 0, waiting: 0, moving: 0, closed: 0 }
  items.forEach(i => { counts[i.group] += 1 })
  const backupTickets = new Set(backups.filter(b => b.need !== 'team').map(b => b.ticket_id))

  // Search: name, ticket number (D-0024, #24 or 24), barangay, sitio, place, team.
  const needle = query.trim().toLowerCase()
  const ticketNo = needle.match(/^(?:#|d-?)?0*(\d+)$/)?.[1]
  const matches = (i: Item) => {
    if (!needle) return true
    if (i.kind === 'sos') {
      const r = residentById.get(i.sos.resident_uid)
      return [i.sos.resident_name, i.sos.barangay_name ?? barangayName(i.sos.barangay_id), r?.sitio, i.sos.alert_type, i.sos.note]
        .some(s => s && s.toLowerCase().includes(needle))
    }
    const t = i.t
    const r = t.resident_uid ? residentById.get(t.resident_uid) : undefined
    if (ticketNo && String(t.ticket_no) === ticketNo) return true
    return [ticketLabel(t), t.subject, r?.name, r?.sitio, barangayName(t.barangay_id), t.location_note, unitById(t.assigned_unit_id)?.unit_name]
      .some(s => s && s.toLowerCase().includes(needle))
  }
  const shown = items.filter(i => {
    const brgy = i.kind === 'sos' ? i.sos.barangay_id : i.t.barangay_id
    if (brgyFilter && String(brgy) !== brgyFilter) return false
    if (prioFilter && i.priority !== prioFilter) return false
    if (groupFilter === 'backup') { if (i.kind !== 'ticket' || !backupTickets.has(i.t.ticket_id)) return false }
    else if (groupFilter && i.group !== groupFilter) return false
    return matches(i)
  })
  // Most urgent first, then whoever has waited longest. Closed: latest first.
  const PRIO_RANK: Record<TicketPriority, number> = { critical: 0, high: 1, normal: 2 }
  const sorted = (g: Group) => shown.filter(i => i.group === g).sort((a, b) => g === 'closed'
    ? Date.parse(b.at ?? '') - Date.parse(a.at ?? '')
    : PRIO_RANK[a.priority] - PRIO_RANK[b.priority] || Date.parse(a.at ?? '') - Date.parse(b.at ?? ''))
  const groups = GROUPS.map(g => ({ ...g, list: sorted(g.key) }))
  const ordered = groups.filter(g => g.key !== 'closed').flatMap(g => g.list)
  const selected = items.find(i => i.key === sel) ?? (draft ? undefined : ordered[0])
  const showClosed = closedOpen || groupFilter === 'closed' || !!needle

  function pick(key: string) {
    setSel(key); setDraft(null); setAction(null); setHistory(null)
    if (window.innerWidth < 1000) setTimeout(() => document.getElementById('op-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
  }
  const toggleGroup = (g: Group | 'backup') => setGroupFilter(f => f === g ? null : g)

  function renderRow(i: Item) {
    const isSel = selected?.key === i.key
    let title: string, sub: ReactNode, pill: ReactNode = null
    if (i.kind === 'sos') {
      const a = i.sos
      title = a.resident_name
      sub = <>{a.alert_type ?? 'SOS'} · {a.barangay_name ?? barangayName(a.barangay_id)}{a.headcount ? ` · ${a.headcount} ${a.headcount === 1 ? 'person' : 'people'}` : ''}
        {outsideCordova(a.latitude, a.longitude) ? ' · Outside Cordova' : ''}</>
      pill = <span className="op-pill pill-sos">{newSos.has(a.alert_id) ? 'New SOS' : 'SOS'}</span>
    } else {
      const t = i.t
      const unit = unitById(t.assigned_unit_id)
      const asked = teamAskOf(t)
      title = `${ticketLabel(t)} · ${ticketName(t)}`
      if (i.group === 'waiting') {
        sub = <>{SOURCE_LABELS[t.source]} · {barangayName(t.barangay_id)}</>
        pill = <span className={`op-pill ${asked ? 'pill-asked' : 'pill-wait'}`}>{asked ? (isSuper ? 'Asks for a team' : 'Asked municipality') : 'No team'}</span>
      } else if (i.group === 'moving') {
        sub = <>{unit?.unit_name ?? 'Team'} · {STATUS_LABELS[t.status]} · {barangayName(t.barangay_id)}</>
        pill = <span className="op-pill pill-step">Step {STEP[t.status] ?? 1}/4</span>
      } else {
        sub = <>{STATUS_LABELS[t.status]} · {barangayName(t.barangay_id)}</>
      }
      if (backupTickets.has(t.ticket_id)) pill = <span className="op-pill pill-sos">Backup asked</span>
    }
    return <li key={i.key}>
      <button type="button" className={`op-row prio-${i.priority}${isSel ? ' is-selected' : ''}${i.kind === 'sos' && newSos.has(i.sos.alert_id) ? ' is-new' : ''}${i.group === 'closed' ? ' is-closed' : ''}`}
        aria-current={isSel ? 'true' : undefined} onClick={() => pick(i.key)}>
        <span className="op-row-main"><strong>{title}</strong><span className="op-row-sub">{sub}</span></span>
        <span className="op-row-side">{pill}<span className="op-row-age">{elapsed(i.at)}</span></span>
      </button>
    </li>
  }

  function sosDraftSeed(a: IntakeSos): Partial<Draft> {
    return { barangay: String(a.barangay_id), resident: a.resident_uid, source: 'sos', sourceRef: a.alert_id,
      sosLevel: a.alert_level, sosNote: a.note ?? '', sosHeadcount: a.headcount,
      visitingFrom: a.home_barangay_id != null && a.home_barangay_id !== a.barangay_id ? (a.home_barangay_name ?? `Barangay ${a.home_barangay_id}`) : null,
      sentFrom: a.barangay_name ?? barangayName(a.barangay_id), subject: `SOS: ${a.alert_type ?? 'assistance'} — ${a.resident_name}`,
      lat: a.latitude != null ? String(a.latitude) : '', lng: a.longitude != null ? String(a.longitude) : '' }
  }
  const smallMap = (lat: unknown, lng: unknown) => lat != null && lng != null && lat !== '' && lng !== ''
    ? <div className="op-map"><TicketLocationMap latitude={String(lat)} longitude={String(lng)} fixed onChange={() => { /* view only */ }} /></div> : null
  const seeOnMap = (lat: unknown, lng: unknown, label: string) => showOnMap && lat != null && lng != null && lat !== '' && lng !== ''
    ? <button type="button" className="secondary-button" onClick={() => showOnMap({ lat: Number(lat), lng: Number(lng), label })}>See on map</button> : null

  function renderSosDetail(a: IntakeSos) {
    return <>
      <div className="op-detail-head">
        <h3>{a.resident_name} <span className={`prio-badge prio-${sosPriority(a)}`}>SOS{a.alert_level ? ` level ${a.alert_level}` : ''}</span>{notVerifiedTag(a.resident_uid)}
          {outsideCordova(a.latitude, a.longitude) && <> <span className="prio-badge prio-high">Outside Cordova</span></>}</h3>
        <p className="dispatch-muted">{a.alert_type ?? 'SOS'} · {a.barangay_name ?? barangayName(a.barangay_id)} · sent {elapsed(a.created_at)} ago</p>
      </div>
      <div className="op-detail-body">
        <SosResidentCard residentUid={a.resident_uid} resident={residentById.get(a.resident_uid)} headcount={a.headcount} note={a.note ?? ''}
          visitingFrom={a.home_barangay_id != null && a.home_barangay_id !== a.barangay_id ? (a.home_barangay_name ?? `Barangay ${a.home_barangay_id}`) : null}
          sentFrom={a.barangay_name ?? barangayName(a.barangay_id)} outsideCordova={outsideCordova(a.latitude, a.longitude)} />
        {smallMap(a.latitude, a.longitude)}
      </div>
      <button type="button" className="op-next" disabled={busy}
        onClick={() => { void loadWithMembers(a.alert_id); openDraft(sosDraftSeed(a)) }}>Create ticket and send a team</button>
      <div className="op-small">{seeOnMap(a.latitude, a.longitude, a.resident_name)}</div>
    </>
  }

  function renderTicketDetail(t: DispatchTicket) {
    const unit = unitById(t.assigned_unit_id)
    const resident = t.resident_uid ? residentById.get(t.resident_uid) : undefined
    const next = nextStatus(t.status)
    const mine = action?.ticketId === t.ticket_id ? action : null
    const closed = columnOf(t.status) === 'closed'
    const unitOptions = rankUnits(ownUnits, t.equipment).filter(r => r.unit.unit_id !== t.assigned_unit_id)
    const teamAsked = teamAskOf(t)
    const canAsk = !isSuper && !teamAsked && t.status === 'open'
    const sosNote = t.source === 'sos' && t.source_ref ? sosNotes.get(t.source_ref) : undefined
    const start = (kind: NonNullable<Action>['kind']) => setAction({ ticketId: t.ticket_id, kind, note: '',
      unit: kind === 'assign' || kind === 'reassign' ? String(unitOptions[0]?.unit.unit_id ?? '') : '' })
    // The one big button: the next step for this request.
    let big: ReactNode = null
    if (!closed && !mine) {
      if (t.status === 'open') {
        big = unitOptions.length
          ? <button type="button" className="op-next" disabled={busy} onClick={() => start('assign')}>Assign a team</button>
          : canAsk ? <button type="button" className="op-next" disabled={busy} onClick={() => start('askTeam')}>Ask the municipality for a team</button>
          : <p className="op-next-note">{teamAsked && !isSuper ? 'Waiting for the municipality to send a team.' : 'No free team right now. Add or free up a team on the Responder teams page.'}</p>
      } else big = <button type="button" className="op-next" disabled={busy} onClick={() => start('resolve')}>Resolve</button>
    }
    return <>
      <div className="op-detail-head">
        <h3>{ticketLabel(t)} · {ticketName(t)} <span className={`prio-badge prio-${t.priority}`}>{PRIORITY_LABELS[t.priority]}</span>
          <span className={`status-badge st-${t.status}`}>{STATUS_LABELS[t.status]}</span></h3>
        <p className="dispatch-muted">{SOURCE_LABELS[t.source]} · {barangayName(t.barangay_id)} · opened {elapsed(t.created_at)} ago{t.created_by_name ? ` by ${t.created_by_name}` : ''}</p>
      </div>
      <div className="op-detail-body">
        <dl className="op-facts">
          {sosNote && <><dt>Resident says</dt><dd>"{sosNote}"</dd></>}
          <dt>What is needed</dt><dd>{t.subject}</dd>
          {resident && <><dt>Resident</dt><dd>{resident.name}{resident.sitio ? ` · Sitio ${resident.sitio}` : ''}{resident.mobilityStatus ? ` · ${resident.mobilityStatus.replace('_', '-')}` : ''}</dd></>}
          {t.location_note && <><dt>Landmark</dt><dd>{t.location_note}</dd></>}
          {t.equipment.length > 0 && <><dt>Bring</dt><dd className="ticket-equip">{t.equipment.map(e => <span key={e}>{e}</span>)}</dd></>}
          {t.instructions && <><dt>Instructions</dt><dd className="ticket-instr">{t.instructions}</dd></>}
          {unit && <><dt>Team</dt><dd><strong>{unit.unit_name}</strong>{unit.borrowed ? ' (sent by the municipality)' : unit.members.length ? ` — ${unit.members.map(m => m.name).join(', ')}` : ' — no members'}
            {t.assigned_at ? ` · assigned ${elapsed(t.assigned_at)} ago` : ''}</dd></>}
          {closed && t.outcome_note && <><dt>{t.status === 'resolved' ? 'Outcome' : 'Canceled'}</dt><dd>{t.outcome_note} · {fmt(t.closed_at)}</dd></>}
        </dl>
        {smallMap(t.latitude, t.longitude)}
      </div>
      {teamAsked && (isSuper
        ? <div className="ticket-backup" role="alert"><span><strong>{barangayName(t.barangay_id)} asks for a team</strong>
            {' '}· asked {elapsed(teamAsked.requested_at)} ago{teamAsked.requested_by_name ? ` by ${teamAsked.requested_by_name}` : ''}{teamAsked.note ? ` — ${teamAsked.note}` : ''}. Sending a team answers it.</span></div>
        : <div className="ticket-waiting" role="status"><span><strong>Waiting for a team from the municipality</strong> · asked {elapsed(teamAsked.requested_at)} ago</span>
            <button type="button" className="link-button" disabled={busy}
              onClick={() => void run(() => closeBackupRequest(teamAsked.request_id, 'cancel'), `Request for a team on ${ticketLabel(t)} taken back.`)}>Take back</button></div>)}
      {otherBackupsOf(t).map(b => <div key={b.request_id} className="ticket-backup" role="alert">
        <span><strong>Backup needed: {BACKUP_NEED_LABELS[b.need] ?? b.need}</strong>
          {' '}· asked {elapsed(b.requested_at)} ago{b.requested_by_name ? ` by ${b.requested_by_name}` : ''}{b.note ? ` — ${b.note}` : ''}</span>
        <button type="button" className="verify-button" disabled={busy}
          onClick={() => void run(() => closeBackupRequest(b.request_id, 'handled'), `Backup for ${ticketLabel(t)} marked as sent.`)}>Mark sent</button>
      </div>)}

      {big}
      {mine && <form className="ticket-action-form" onSubmit={e => {
        e.preventDefault()
        if (mine.kind === 'askTeam') void run(() => requestTeam(t.ticket_id, mine.note), `Asked the municipality for a team for ${ticketLabel(t)}.`)
        else if (mine.kind === 'assign' || mine.kind === 'reassign') void run(() => assignDispatchTicket(t.ticket_id, Number(mine.unit), mine.note), `${ticketLabel(t)} assigned to ${unitById(Number(mine.unit))?.unit_name}.`)
        else if (mine.kind === 'resolve') void run(() => updateDispatchStatus(t.ticket_id, 'resolved', mine.note), `${ticketLabel(t)} resolved.`)
        else if (t.status === 'open') void run(() => cancelOpenDispatchTicket(t.ticket_id, mine.note), `${ticketLabel(t)} canceled.`)
        else void run(() => updateDispatchStatus(t.ticket_id, 'cancelled', mine.note), `${ticketLabel(t)} canceled.`)
      }}>
        <h4>{({ assign: 'Assign a team', reassign: 'Send a different team', resolve: 'Resolve this request', cancel: 'Cancel this request', askTeam: 'Ask the municipality for a team' } as const)[mine.kind]}</h4>
        {(mine.kind === 'assign' || mine.kind === 'reassign') && <label>Responder team
          <select value={mine.unit} onChange={e => setAction({ ...mine, unit: e.target.value })}>
            {unitOptions.map(r => <option key={r.unit.unit_id} value={r.unit.unit_id}>
              {r.unit.unit_name} · {r.unit.live_tickets} live{t.equipment.length ? ` · has ${r.covered}/${t.equipment.length} equipment` : ''}{r.unit.members.length ? '' : ' · no members'}</option>)}
          </select></label>}
        {mine.kind === 'askTeam' && <p className="dispatch-muted">The municipal admin sees this right away and sends a team from another barangay. You will see the team's name and progress here.</p>}
        <label>{mine.kind === 'askTeam' ? 'Note for the municipality (optional), e.g. "Our team is busy, 3 people, water rising"' : mine.kind === 'resolve' ? 'Outcome (required)' : mine.kind === 'cancel' ? 'Reason (required), e.g. "Not a real emergency"' : mine.kind === 'reassign' && t.status !== 'assigned' ? 'Reason for changing teams (required)' : 'Note (optional)'}
          <textarea rows={2} maxLength={1000} value={mine.note} onChange={e => setAction({ ...mine, note: e.target.value })}
            required={mine.kind !== 'assign' && mine.kind !== 'askTeam' && !(mine.kind === 'reassign' && t.status === 'assigned')} /></label>
        <div className="ticket-actions">
          <button type="submit" className="verify-button" disabled={busy}>{busy ? 'Saving…' : mine.kind === 'askTeam' ? 'Send request' : 'Confirm'}</button>
          <button type="button" className="secondary-button" disabled={busy} onClick={() => setAction(null)}>Back</button>
        </div>
      </form>}

      <div className="op-small">
        {!closed && !mine && <>
          {canAsk && unitOptions.length > 0 && <button type="button" className="secondary-button" disabled={busy} onClick={() => start('askTeam')}>Ask the municipality for a team</button>}
          {next && <button type="button" className="secondary-button" disabled={busy} title="Normally updated by the team from the app"
            onClick={() => void run(() => updateDispatchStatus(t.ticket_id, next, ''), `${ticketLabel(t)} marked ${STATUS_LABELS[next].toLowerCase()}.`)}>Mark {STATUS_LABELS[next].toLowerCase()}</button>}
          {t.status !== 'open' && <button type="button" className="secondary-button" disabled={busy || !unitOptions.length} onClick={() => start('reassign')}>Send a different team</button>}
          <button type="button" className="secondary-button" disabled={busy} onClick={() => start('cancel')}>Cancel request</button>
        </>}
        {seeOnMap(t.latitude, t.longitude, ticketLabel(t))}
        <button type="button" className="secondary-button" onClick={async () => {
          if (history?.ticketId === t.ticket_id) { setHistory(null); return }
          try { setHistory({ ticketId: t.ticket_id, rows: await getDispatchTicketHistory(t.ticket_id) }) } catch (e) { setError(e instanceof Error ? e.message : 'History failed.') }
        }}>{history?.ticketId === t.ticket_id ? 'Hide history' : 'History'}</button>
      </div>
      {history?.ticketId === t.ticket_id && <ol className="ticket-history">{history.rows.map((h, i) => <li key={i}>
        <span>{fmt(h.recorded_at)}</span> {h.action}{h.to_status ? ` → ${STATUS_LABELS[h.to_status as keyof typeof STATUS_LABELS] ?? h.to_status}` : ''}
        {h.unit_name ? ` (${h.unit_name})` : ''}{h.actor_name ? ` · ${h.actor_name}` : ''}{h.note ? ` — ${h.note}` : ''}</li>)}</ol>}
    </>
  }

  function renderDraft(d: Draft, b: DispatchBoard) {
    return <>
      <div className="op-detail-head"><h3>{d.source === 'sos' ? `Create ticket: ${d.subject.replace(/^SOS: .*? — /, '')}` : 'New rescue request'}</h3>
        <p className="dispatch-muted">Check the details, pick a team, then press the green button.</p></div>
      <form onSubmit={e => void submitDraft(e)}>
        <fieldset className="dispatch-form" disabled={busy}>
          {d.source === 'sos' && d.resident && <div className="wide"><SosResidentCard residentUid={d.resident} resident={residentById.get(d.resident)}
            headcount={d.sosHeadcount} note={d.sosNote} visitingFrom={d.visitingFrom} sentFrom={d.sentFrom} withMembers={d.withMembers}
            outsideCordova={outsideCordova(d.lat, d.lng)} /></div>}
          <label>Barangay<select value={d.barangay} disabled={d.source !== 'manual'} onChange={e => setDraft({ ...d, barangay: e.target.value, resident: '', event: '' })}>
            {b.barangays.map(s => <option key={s.barangay_id} value={s.barangay_id}>{s.barangay_name}</option>)}</select></label>
          <label>Disaster event (optional)<select value={d.event} onChange={e => setDraft({ ...d, event: e.target.value })}>
            <option value="">None</option>{b.events.filter(ev => String(ev.barangay_id) === d.barangay).map(ev => <option key={ev.event_id} value={ev.event_id}>{ev.name}</option>)}</select></label>
          {d.source !== 'sos' && <label className="wide">Resident (optional)<select value={d.resident} onChange={e => pickResident(e.target.value)}>
            <option value="">No specific resident</option>{draftResidents.map(r => <option key={r.id} value={r.id}>{r.name}{r.mobilityStatus ? ` · ${r.mobilityStatus.replace('_', '-')}` : ''}</option>)}</select></label>}
          {d.source !== 'sos' && <label className="wide">What is needed<input required maxLength={200} value={d.subject} onChange={e => setDraft({ ...d, subject: e.target.value })} placeholder="e.g. Evacuate bedridden elder, Purok 2" /></label>}
          <label>Priority<select value={d.priority} onChange={e => setDraft({ ...d, priority: e.target.value as TicketPriority })}>
            {(['critical', 'high', 'normal'] as const).map(p => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}</select>
            {draftSuggestion && draftSuggestion.reasons.length > 0 && <small className="dispatch-muted">Suggested {PRIORITY_LABELS[draftSuggestion.priority]}: {draftSuggestion.reasons.join(', ')}</small>}</label>
          <label>Team to send<select value={d.unit} onChange={e => setDraft({ ...d, unit: e.target.value })}>
            <option value="">No team yet</option>
            {ranked.map(r => <option key={r.unit.unit_id} value={r.unit.unit_id}>{r.unit.unit_name} · {r.unit.live_tickets} live{d.equipment.length ? ` · has ${r.covered}/${d.equipment.length}` : ''}</option>)}</select>
            {!ranked.length && <small className="dispatch-muted">{isSuper ? 'No active team yet.' : 'No team of yours is active. Create the ticket, then ask the municipality for a team.'}</small>}</label>
          <div className="wide"><span className="dispatch-label">Where to go</span>
            <TicketLocationMap latitude={d.lat} longitude={d.lng} fixed={d.source === 'sos'}
              home={(() => { const r = residentById.get(d.resident); const la = Number(r?.gpsLat), lo = Number(r?.gpsLong)
                return r && r.gpsLat != null && Number.isFinite(la) && Number.isFinite(lo) && la !== 0 ? { lat: la, lng: lo } : null })()}
              onChange={(lat, lng) => setDraft((x) => (x ? { ...x, lat, lng } : x))} /></div>
          <label className="wide">Location / landmark<input maxLength={500} value={d.locationNote} onChange={e => setDraft({ ...d, locationNote: e.target.value })} /></label>
          <div className="wide"><span className="dispatch-label">Equipment to bring</span>
            <div className="dispatch-checks">{[...new Set([...EQUIPMENT_OPTIONS, ...d.equipment])].map(eq => <label key={eq} className="dispatch-chip">
              <input type="checkbox" checked={d.equipment.includes(eq)} onChange={e => setDraft({ ...d, equipment: e.target.checked ? [...d.equipment, eq] : d.equipment.filter(x => x !== eq) })} />{eq}</label>)}</div>
            {draftSuggestion && draftSuggestion.equipmentReasons.length > 0 && <ul className="equip-reasons">
              {draftSuggestion.equipmentReasons.map(n => <li key={n.equipment}><strong>{n.equipment}</strong> — {n.reasons.join('; ')}</li>)}</ul>}
            <small className="dispatch-muted">Pre-filled from the resident's profile (mobility, disabilities, pregnancy, age, household members). Responders confirm on site.</small></div>
          <label className="wide">Instructions for the team<textarea rows={3} maxLength={2000} value={d.instructions} onChange={e => setDraft({ ...d, instructions: e.target.value })} /></label>
          <div className="wide">
            <button type="submit" className="op-next">{busy ? 'Saving…' : d.unit ? 'Create ticket and send this team' : 'Create ticket'}</button>
            <div className="op-small"><button type="button" className="secondary-button" onClick={() => setDraft(null)}>Discard</button></div>
          </div>
        </fieldset>
      </form>
    </>
  }

  const COUNTERS: { key: Group | 'backup'; label: string; n: number; tone?: string }[] = [
    { key: 'sos', label: 'Needs a ticket', n: counts.sos, tone: counts.sos ? 'bad' : '' },
    { key: 'waiting', label: 'Waiting for a team', n: counts.waiting, tone: counts.waiting ? 'warn' : '' },
    { key: 'moving', label: 'Team on the way', n: counts.moving },
    { key: 'backup', label: 'Backup asked', n: backupTickets.size, tone: backupTickets.size ? 'bad' : '' },
    { key: 'closed', label: 'Closed (7 days)', n: counts.closed },
  ]
  const freeTeams = ownUnits.filter(u => u.is_active && u.live_tickets === 0).length

  return <div className="dispatch-page">
    <section className="panel dispatch-top">
      <div className="dispatch-head">
        <div><h3>{tab === 'units' ? 'Responder teams' : 'Rescue requests'}</h3>
          <p className="dispatch-muted">{tab === 'units'
            ? 'Teams that can be sent to a rescue request. Members see their team\'s rescues in the app.'
            : 'Every SOS and rescue in one list, most urgent first. Pick one to see the details and its next step.'}</p></div>
        <div className="ticket-actions">
          {tab === 'board' && <button type="button" className="primary-button" disabled={!board || busy} onClick={() => { setSel(null); openDraft() }}>+ New request</button>}
          <button type="button" className="secondary-button" disabled={loading || busy} onClick={() => void load()}>Refresh</button>
        </div>
      </div>
      {board && tab === 'board' && <>
        <div className="op-counters" role="group" aria-label="Show only">
          {COUNTERS.map(c => <button key={c.key} type="button" className={`op-counter${groupFilter === c.key ? ' is-on' : ''}`}
            aria-pressed={groupFilter === c.key} onClick={() => toggleGroup(c.key)}>
            <strong className={c.tone}>{c.n}</strong><span>{c.label}</span></button>)}
        </div>
        <div className="op-toolbar">
          <input type="search" className="op-search" placeholder="Search name, ticket #, barangay or sitio…" value={query} onChange={e => setQuery(e.target.value)} aria-label="Search rescue requests" />
          {board.barangays.length > 1 && <select value={brgyFilter} onChange={e => setBrgyFilter(e.target.value)} aria-label="Barangay">
            <option value="">All barangays</option>{board.barangays.map(s => <option key={s.barangay_id} value={s.barangay_id}>{s.barangay_name}</option>)}</select>}
          <select value={prioFilter} onChange={e => setPrioFilter(e.target.value as TicketPriority | '')} aria-label="Priority">
            <option value="">Any priority</option>{(['critical', 'high', 'normal'] as const).map(p => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}</select>
          <span className="dispatch-muted">{freeTeams} free team{freeTeams === 1 ? '' : 's'}</span>
        </div>
      </>}
      {error && <p role="alert" className="dispatch-error">{error}</p>}
      {notice && <p role="status" className="dispatch-notice">{notice}</p>}
      {loading && <p role="status">Loading rescue requests…</p>}
    </section>

    {board && tab === 'board' && <>
      <div className="op-split">
        <section className="panel op-list" aria-label="Rescue requests">
          {groups.map(g => {
            if (g.key === 'closed') return <div key={g.key}>
              <button type="button" className="op-group op-group-toggle" aria-expanded={showClosed} onClick={() => setClosedOpen(o => !o)}>
                {g.title} ({g.list.length}) {showClosed ? '▾' : '▸'}</button>
              {showClosed && <ul>{g.list.map(renderRow)}</ul>}
            </div>
            if (!g.list.length && groupFilter !== g.key) return null
            return <div key={g.key}>
              <h4 className="op-group">{g.title} ({g.list.length})</h4>
              {g.list.length ? <ul>{g.list.map(renderRow)}</ul> : <p className="dispatch-muted op-empty">Nothing here right now.</p>}
            </div>
          })}
          {!shown.length && <p className="dispatch-muted op-empty">{items.length ? 'Nothing matches the search or filters.' : 'No SOS or rescue requests right now.'}</p>}
        </section>

        <section id="op-detail" className="panel op-detail" aria-live="polite">
          {draft ? renderDraft(draft, board)
            : selected?.kind === 'sos' ? renderSosDetail(selected.sos)
            : selected?.kind === 'ticket' ? renderTicketDetail(selected.t)
            : <p className="dispatch-muted op-empty">Pick a request on the left to see its details.</p>}
        </section>
      </div>

      {missingCount > 0 && <p className="dispatch-muted missing-hint">
        {missingCount} missing-person report{missingCount === 1 ? ' is' : 's are'} open on the{' '}
        {onOpenMissing ? <button type="button" className="link-button" onClick={onOpenMissing}>Missing persons tab</button> : 'Missing persons tab'}.
        To send a search team, use New request.</p>}

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
    </>}

    {board && tab === 'units' && <section className="panel">
      <div className="dispatch-head"><h3>Responder teams</h3>
        <button type="button" className="primary-button" disabled={busy} onClick={() => editUnit(null)}>New team</button></div>
      <p className="dispatch-muted">Each barangay sends only its own teams. When all of yours are busy, use "Ask the municipality for a team" on the rescue request; the municipal admin sends one from another barangay. Members are responder accounts assigned to your barangay; they see their team's rescues in the app.</p>
      {unitDraft && <SidePanel title={unitDraft.unitId ? `Edit team: ${unitDraft.name}` : 'New team'} busy={busy} error={error} onClose={() => setUnitDraft(null)}><form className="unit-form" onSubmit={e => void submitUnit(e)}>
        <fieldset className="dispatch-form" disabled={busy}>
          <label>Team name<input required maxLength={80} value={unitDraft.name} onChange={e => setUnitDraft({ ...unitDraft, name: e.target.value })} placeholder="e.g. Alpha Team" /></label>
          <label>Home barangay<select value={unitDraft.barangay} onChange={e => setUnitDraft({ ...unitDraft, barangay: e.target.value })}>
            {board.is_super_admin && <option value="">Barangay-wide</option>}
            {board.barangays.map(s => <option key={s.barangay_id} value={s.barangay_id}>{s.barangay_name}</option>)}</select></label>
          <div className="wide"><span className="dispatch-label">Capabilities / equipment carried</span>
            <div className="dispatch-checks">{[...new Set([...EQUIPMENT_OPTIONS, ...unitDraft.capabilities])].map(c => <label key={c} className="dispatch-chip">
              <input type="checkbox" checked={unitDraft.capabilities.includes(c)} onChange={e => setUnitDraft({ ...unitDraft, capabilities: e.target.checked ? [...unitDraft.capabilities, c] : unitDraft.capabilities.filter(x => x !== c) })} />{c}</label>)}</div>
            <input className="unit-extra" placeholder="Other (comma-separated), e.g. Chainsaw, Medic" value={unitDraft.extraCap} onChange={e => setUnitDraft({ ...unitDraft, extraCap: e.target.value })} /></div>
          <MemberPicker rescuers={board.rescuers} value={unitDraft.members} onChange={members => setUnitDraft({ ...unitDraft, members })} />
          <label className="dispatch-chip"><input type="checkbox" checked={unitDraft.active} onChange={e => setUnitDraft({ ...unitDraft, active: e.target.checked })} />Active (can be assigned)</label>
          <div className="wide ticket-actions">
            <button type="submit" className="primary-button">{busy ? 'Saving…' : 'Save team'}</button>
            <button type="button" className="secondary-button" onClick={() => setUnitDraft(null)}>Cancel</button>
          </div>
        </fieldset>
      </form></SidePanel>}
      <div className="unit-grid">
        {ownUnits.map(u => <article key={u.unit_id} className={`unit-card${u.is_active ? '' : ' inactive'}`}>
          <div className="ticket-head"><strong>{u.unit_name}</strong><span className={`status-badge ${u.is_active ? (u.live_tickets ? 'st-en_route' : 'st-resolved') : 'st-cancelled'}`}>
            {u.is_active ? (u.live_tickets ? `${u.live_tickets} live ticket${u.live_tickets === 1 ? '' : 's'}` : 'Available') : 'Inactive'}</span></div>
          <p className="dispatch-muted">{barangayName(u.barangay_id)}</p>
          {u.capabilities.length > 0 && <p className="ticket-equip">{u.capabilities.map(c => <span key={c}>{c}</span>)}</p>}
          {u.members.length
            ? <details className="member-summary"><summary>{u.members.length} member{u.members.length === 1 ? '' : 's'}</summary>
              <ul>{u.members.map(m => <li key={m.uid}>{m.name}{m.contact_no ? ` · ${m.contact_no}` : ''}</li>)}</ul></details>
            : <p className="dispatch-muted">No members yet</p>}
          {u.editable && <button type="button" className="secondary-button" disabled={busy} onClick={() => editUnit(u)}>Edit</button>}
        </article>)}
        {!ownUnits.length && <p className="dispatch-muted">No units yet. Create one to start assigning tickets.</p>}
      </div>
    </section>}
  </div>
}
