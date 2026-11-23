import { useEffect, useState } from 'react'
import { useLiveSignal } from '../lib/useLiveSignal'
import { getBackupRequests, getDispatchBoard } from '../api/dispatchApi'
import { columnOf } from '../utils/dispatch'
import { getRescueReconciliation } from '../api/missingPersonsApi'
import { getPreemptiveBoard } from '../api/preemptiveEvacuationApi'
import { scoreHouseholds } from '../utils/householdVpi'
import { VPI_CRITICAL_AT } from '../utils/vpi'
import { supabase } from '../lib/supabaseClient'
import type { EvacuationCenter, MenuKey, Resident } from '../types/dashboard'
import type { OperationStatus } from '../lib/useOperationStatus'
import { Icon } from './Icon'
import './TodayTasks.css'

// The Today page, top to bottom:
//  1. One status line: all calm, something to check, or a disaster is active.
//  2. Four numbers (residents, CRITICAL households, centers open, people in centers).
//  3. Super admin (all of Cordova) only: the barangays where something is happening.
//  4. To do, split into "Do now" and "When you have time". Each row opens the page where it gets done.
// Each source loads on its own; a source that fails just leaves its part out.

type ActiveEvent = OperationStatus['active'][number]

type Props = {
  // null = every barangay (super admin "All barangays" scope).
  scopeBarangayId: number | null
  // "Alegria", or "All barangays" for the super admin.
  scopeLabel: string
  isSuperAdmin: boolean
  residents: Resident[]
  centers: EvacuationCenter[]
  onOpen: (menu: MenuKey) => void
  // Hazard reports still waiting for Yes or No (step 1 of every operation).
  waitingAlarms: number
  // Disasters declared right now, already limited to the scope.
  activeEvents: ActiveEvent[]
}

type Task = {
  key: string
  now: boolean
  title: string
  action: string
  menu: MenuKey
  // Optional second line, e.g. the first few names.
  detail?: string
}

type Live = {
  sosNames: string[]
  // Open rescue tickets (not closed), by barangay.
  ticketsBy: Map<number, number>
  missing: number
  // Municipal admin only: barangays that asked for a team (STEP32).
  teamAsksBy: Map<number, number>
  allBarangays: { barangay_id: number; barangay_name: string }[]
  // Per disaster: households in that disaster's barangay with no evacuation report yet.
  noReport: Record<string, number>
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const names = (list: string[]) => `${list.slice(0, 3).join(', ')}${list.length > 3 ? ` and ${list.length - 3} more` : ''}`
const sum = (m: Map<number, number>) => [...m.values()].reduce((t, v) => t + v, 0)
const count = (m: Map<number, number>, id: number) => m.get(id) ?? 0
function tally(ids: number[]) {
  const m = new Map<number, number>()
  ids.forEach((id) => m.set(id, (m.get(id) ?? 0) + 1))
  return m
}

export function TodayTasks({ scopeBarangayId, scopeLabel, isSuperAdmin, residents, centers, onOpen, waitingAlarms, activeEvents }: Props) {
  const [live, setLive] = useState<Live | null>(null)
  // Re-count when the app or another admin changes something.
  const [tick, setTick] = useState(0)
  useLiveSignal(['sos', 'tickets', 'events', 'missing', 'preemptive'], () => setTick((n) => n + 1))
  const eventKey = activeEvents.map((e) => e.event_id).join(',')

  useEffect(() => {
    let cancelled = false
    const value = <T,>(result: PromiseSettledResult<T>) => (result.status === 'fulfilled' ? result.value : null)
    void (async () => {
      const [dispatch, reconciliation, backups] = await Promise.allSettled([getDispatchBoard(), getRescueReconciliation(), getBackupRequests()])
      const board = value(dispatch)
      const data = value(reconciliation)
      const inScope = (barangayId: number | null) => scopeBarangayId === null || barangayId === scopeBarangayId
      // Only chase evacuation reports while a disaster is declared.
      const noReport: Record<string, number> = {}
      const events = eventKey ? eventKey.split(',') : []
      if (events.length) {
        try {
          const evac = await getPreemptiveBoard(scopeBarangayId)
          for (const e of activeEvents) noReport[e.event_id] = evac.residents.filter((r) => r.barangay_id === e.barangay_id && !r.latest).length
        } catch { /* leave the counts out */ }
      }
      if (cancelled) return
      setLive({
        sosNames: board ? board.intake_sos.filter((a) => inScope(a.barangay_id)).map((a) => a.resident_name) : [],
        ticketsBy: tally(board ? board.tickets.filter((t) => columnOf(t.status) !== 'closed' && inScope(t.barangay_id)).map((t) => t.barangay_id) : []),
        missing: data ? data.reports.filter((r) => r.status === 'missing' && inScope(r.barangay_id)).length : 0,
        teamAsksBy: tally(board?.is_super_admin ? (value(backups) ?? []).filter((b) => b.need === 'team' && inScope(b.barangay_id)).map((b) => b.barangay_id) : []),
        allBarangays: board?.barangays ?? [],
        noReport,
      })
    })()
    return () => { cancelled = true }
    // activeEvents is read through eventKey so a new array with the same events does not reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeBarangayId, tick, eventKey])

  // Sitio lists: which barangays have typed their official sitios.
  const [sitioBarangays, setSitioBarangays] = useState<Set<number> | null>(null)
  useEffect(() => {
    let cancelled = false
    supabase.from('sitios').select('barangay_id')
      .then(({ data, error }) => { if (!cancelled && !error) setSitioBarangays(new Set((data ?? []).map((r: { barangay_id: number }) => r.barangay_id))) })
    return () => { cancelled = true }
  }, [tick])

  const place = scopeBarangayId === null ? 'Cordova' : scopeLabel
  const municipal = isSuperAdmin && scopeBarangayId === null

  // ---- Numbers
  const pending = residents.filter((r) => r.status === 'Pending')
  const critical = scoreHouseholds(residents).filter((h) => h.score >= VPI_CRITICAL_AT).length
  // A barangay admin also sees open centers of other barangays (mutual aid); count only their own.
  const ownCenters = scopeBarangayId === null ? centers : centers.filter((c) => c.barangayId == null || c.barangayId === scopeBarangayId)
  const openCenters = ownCenters.filter((c) => c.status.toLowerCase() !== 'closed')
  const spacesFree = openCenters.reduce((t, c) => t + Math.max(0, c.capacity - c.occupied), 0)
  const inCenters = ownCenters.reduce((t, c) => t + c.occupied, 0)
  const ticketsOpen = live ? sum(live.ticketsBy) : 0

  // ---- To do
  const tasks: Task[] = []
  if (waitingAlarms) {
    tasks.push({ key: 'alarms', now: true, menu: 'disasterEvents', action: 'Check',
      title: `${plural(waitingAlarms, 'hazard report needs', 'hazard reports need')} a Yes or No` })
  }
  if (live?.sosNames.length) {
    tasks.push({ key: 'sos', now: true, menu: 'dispatch', action: 'Answer',
      title: `${plural(live.sosNames.length, 'SOS call needs', 'SOS calls need')} a ticket`, detail: names(live.sosNames) })
  }
  // Team requests show in the Barangays box for the municipal view; elsewhere they are a task.
  if (!municipal && live && sum(live.teamAsksBy)) {
    tasks.push({ key: 'team-asks', now: true, menu: 'dispatch', action: 'Send a team',
      title: `${plural(sum(live.teamAsksBy), 'rescue needs', 'rescues need')} a team from the municipality` })
  }
  for (const event of activeEvents) {
    const n = live?.noReport[event.event_id]
    if (n) {
      tasks.push({ key: `event-${event.event_id}`, now: true, menu: 'preemptiveEvacuation', action: 'Check',
        title: `${plural(n, 'household has', 'households have')} not said if they evacuated`,
        detail: activeEvents.length > 1 ? `${event.name} (${event.barangay_name})` : undefined })
    }
  }
  if (live?.missing) {
    tasks.push({ key: 'missing', now: true, menu: 'rescueReconciliation', action: 'View',
      title: `${plural(live.missing, 'person is', 'people are')} reported missing` })
  }
  const nearlyFull = openCenters.filter((c) => c.capacity > 0 && c.occupied / c.capacity >= 0.9)
  if (nearlyFull.length) {
    tasks.push({ key: 'full', now: true, menu: 'evacCenters', action: 'View',
      title: nearlyFull.length === 1 ? `${nearlyFull[0].name} is almost full` : `${nearlyFull.length} centers are almost full`,
      detail: nearlyFull.length > 1 ? names(nearlyFull.map((c) => c.name)) : undefined })
  }
  if (pending.length) {
    const barangayCount = new Set(pending.map((r) => r.barangay)).size
    tasks.push({ key: 'pending', now: false, menu: 'verification', action: 'Verify',
      title: `${plural(pending.length, 'resident', 'residents')} to verify`,
      detail: municipal && barangayCount > 1 ? `In ${barangayCount} barangays. Each barangay admin verifies their own; you can too.` : names(pending.map((r) => r.name)) })
  }
  if (sitioBarangays) {
    if (scopeBarangayId !== null && !sitioBarangays.has(scopeBarangayId)) {
      tasks.push({ key: 'sitio-list', now: false, menu: 'population', action: 'Add sitios',
        title: 'Your barangay has no sitio list yet', detail: 'Residents can\'t pick their sitio until you add one.' })
    }
    if (municipal && live?.allBarangays.length) {
      const missingList = live.allBarangays.filter((b) => !sitioBarangays.has(b.barangay_id))
      if (missingList.length) {
        tasks.push({ key: 'sitio-lists', now: false, menu: 'population', action: 'View',
          title: `${plural(missingList.length, 'barangay has', 'barangays have')} no sitio list yet`, detail: names(missingList.map((b) => b.barangay_name)) })
      }
    }
  }
  if (scopeBarangayId !== null) {
    const noSitio = residents.filter((r) => !(r.sitio ?? '').trim())
    if (noSitio.length) {
      tasks.push({ key: 'no-sitio', now: false, menu: 'verification', action: 'Open residents',
        title: `${plural(noSitio.length, 'resident has', 'residents have')} no sitio`, detail: 'Set it in each resident\'s Edit details.' })
    }
  }
  const doNow = tasks.filter((t) => t.now)
  const later = tasks.filter((t) => !t.now)

  // ---- Status line
  const status = activeEvents.length
    ? {
      tone: 'alert',
      title: activeEvents.length === 1
        ? `${activeEvents[0].name} is active${municipal ? ` in ${activeEvents[0].barangay_name}` : ''}`
        : `${activeEvents.length} disasters active: ${[...new Set(activeEvents.map((e) => e.barangay_name))].join(', ')}`,
      text: `${plural(ticketsOpen, 'rescue', 'rescues')} open · ${plural(inCenters, 'person', 'people')} in centers`,
    }
    : doNow.length
      ? { tone: 'watch', title: `No active disaster in ${place}`, text: `${plural(doNow.length, 'thing needs', 'things need')} checking below.` }
      : { tone: 'calm', title: `All calm in ${place}`, text: 'No hazard reports, no SOS calls, no active disaster.' }

  // ---- Barangays box (municipal view)
  const busy = municipal && live
    ? live.allBarangays
      .map((b) => ({
        ...b,
        events: activeEvents.filter((e) => e.barangay_id === b.barangay_id),
        tickets: count(live.ticketsBy, b.barangay_id),
        asks: count(live.teamAsksBy, b.barangay_id),
      }))
      .filter((b) => b.events.length || b.tickets || b.asks)
      .sort((a, b) => b.asks - a.asks || b.events.length - a.events.length || b.tickets - a.tickets)
    : []

  return (
    <div className="today-page">
      <section className={`today-status is-${status.tone}`} aria-live="polite">
        <i className="today-dot" aria-hidden="true" />
        <div>
          <strong>{status.title}</strong>
          <span>{live ? status.text : 'Checking…'}</span>
        </div>
        {activeEvents.length > 0 && <button type="button" className="danger-button today-status-btn" onClick={() => onOpen('dispatch')}>Open operation</button>}
      </section>

      <section className="today-nums" aria-label="At a glance">
        <div className="today-num"><strong>{residents.length.toLocaleString()}</strong><span>Residents</span>
          <small>{pending.length ? `${pending.length} waiting to verify` : 'all verified'}</small></div>
        <div className="today-num"><strong className={critical ? 'is-red' : ''}>{critical}</strong><span>CRITICAL households</span><small>need help first</small></div>
        <div className="today-num"><strong>{openCenters.length} of {ownCenters.length}</strong><span>Centers open</span><small>{spacesFree.toLocaleString()} spaces free</small></div>
        <div className="today-num"><strong>{inCenters.toLocaleString()}</strong><span>People in centers</span><small>right now</small></div>
      </section>

      {municipal && live && (
        <section className="panel today-box" aria-labelledby="today-brgy">
          <h3 id="today-brgy">Barangays</h3>
          {busy.length > 0 && <ul className="today-rows">
            {busy.map((b) => (
              <li key={b.barangay_id} className={b.events.length || b.asks ? 'is-now' : ''}>
                <span className="today-text"><strong>{b.barangay_name}{b.events.length ? ` · ${b.events.map((e) => e.name).join(', ')}` : ''}</strong>
                  <small>{[plural(b.tickets, 'rescue open', 'rescues open'), b.asks ? 'asked the municipality for a team' : ''].filter(Boolean).join(' · ')}</small></span>
                <button type="button" className={b.asks ? 'primary-button' : 'secondary-button'} onClick={() => onOpen('dispatch')}>{b.asks ? 'Send a team' : 'View'}</button>
              </li>
            ))}
          </ul>}
          <p className="today-muted">{busy.length
            ? `The other ${plural(live.allBarangays.length - busy.length, 'barangay is', 'barangays are')} calm.`
            : `All ${live.allBarangays.length} barangays are calm.`}</p>
        </section>
      )}

      <section className="panel today-box" aria-labelledby="today-heading">
        <h3 id="today-heading">To do</h3>
        {!tasks.length
          ? <p className="today-clear"><Icon name="check" /> Nothing to do right now.</p>
          : <>
            {doNow.length > 0 && <TaskGroup title="Do now" tasks={doNow} onOpen={onOpen} now />}
            {later.length > 0 && <TaskGroup title="When you have time" tasks={later} onOpen={onOpen} />}
          </>}
      </section>
    </div>
  )
}

function TaskGroup({ title, tasks, onOpen, now = false }: { title: string; tasks: Task[]; onOpen: (menu: MenuKey) => void; now?: boolean }) {
  return (
    <div className="today-group">
      <h4>{title}</h4>
      <ul className="today-rows">
        {tasks.map((task) => (
          <li key={task.key} className={now ? 'is-now' : ''}>
            <span className="today-text"><strong>{task.title}</strong>{task.detail && <small>{task.detail}</small>}</span>
            <button type="button" className={now ? 'primary-button' : 'secondary-button'} onClick={() => onOpen(task.menu)}>{task.action}</button>
          </li>
        ))}
      </ul>
    </div>
  )
}
