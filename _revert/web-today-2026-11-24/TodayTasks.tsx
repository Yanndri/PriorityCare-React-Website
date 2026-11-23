import { useEffect, useState } from 'react'
import { useLiveSignal } from '../lib/useLiveSignal'
import { getBackupRequests, getDispatchBoard } from '../api/dispatchApi'
import { columnOf } from '../utils/dispatch'
import { getRescueReconciliation } from '../api/missingPersonsApi'
import { getPreemptiveBoard } from '../api/preemptiveEvacuationApi'
import { supabase } from '../lib/supabaseClient'
import type { EvacuationCenter, MenuKey, Resident } from '../types/dashboard'
import { Icon } from './Icon'
import './TodayTasks.css'

// The "Today" to-do list at the top of the dashboard: each card says what
// needs doing in plain words and opens the page where it gets done, so a
// barangay officer rarely needs the sidebar. Each source loads on its own;
// a source that fails just leaves its card out.

type Props = {
  // null = every barangay (super admin "All barangays" scope).
  scopeBarangayId: number | null
  residents: Resident[]
  centers: EvacuationCenter[]
  onOpen: (menu: MenuKey) => void
  // Hazard reports still waiting for Yes or No (step 1 of every operation).
  waitingAlarms: number
}

type Tone = 'urgent' | 'warn' | 'info'

type Task = {
  key: string
  tone: Tone
  icon: string
  title: string
  action: string
  menu: MenuKey
  // Optional second line, e.g. the first few names.
  detail?: string
}

type Live = {
  activeSos: number | null
  teamsOut: number | null
  events: { event_id: string; name: string }[] | null
  missing: number | null
  // Municipal admin only: rescues whose barangay asked for a team (STEP32).
  teamAsks: number
  // Per disaster: households in that disaster's barangay with no evacuation report yet.
  noReport: Record<string, number>
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function TodayTasks({ scopeBarangayId, residents, centers, onOpen, waitingAlarms }: Props) {
  const [live, setLive] = useState<Live | null>(null)
  // Re-count when the app or another admin changes something.
  const [tick, setTick] = useState(0)
  useLiveSignal(['sos', 'tickets', 'events', 'missing', 'preemptive'], () => setTick((n) => n + 1))

  useEffect(() => {
    let cancelled = false
    const value = <T,>(result: PromiseSettledResult<T>) => (result.status === 'fulfilled' ? result.value : null)
    void (async () => {
      // Same numbers as the Operation page: SOS calls that still need a ticket, and live tickets.
      const [dispatch, reconciliation, backups] = await Promise.allSettled([getDispatchBoard(), getRescueReconciliation(), getBackupRequests()])
      const board = value(dispatch)
      const data = value(reconciliation)
      const inScope = (barangayId: number | null) => scopeBarangayId === null || barangayId === scopeBarangayId
      const events = data ? data.events.filter((e) => e.status === 'active' && inScope(e.barangay_id)) : null
      // Only chase evacuation reports while a disaster is declared.
      const noReport: Record<string, number> = {}
      if (events?.length) {
        try {
          const evac = await getPreemptiveBoard(scopeBarangayId)
          for (const e of events) noReport[e.event_id] = evac.residents.filter((r) => r.barangay_id === e.barangay_id && !r.latest).length
        } catch { /* leave the counts out */ }
      }
      if (cancelled) return
      setLive({
        activeSos: board ? board.intake_sos.filter((a) => inScope(a.barangay_id)).length : null,
        teamsOut: board ? board.tickets.filter((t) => columnOf(t.status) !== 'closed' && inScope(t.barangay_id)).length : null,
        events,
        missing: data ? data.reports.filter((r) => r.status === 'missing' && inScope(r.barangay_id)).length : null,
        teamAsks: board?.is_super_admin ? (value(backups) ?? []).filter((b) => b.need === 'team' && inScope(b.barangay_id)).length : 0,
        noReport,
      })
    })()
    return () => { cancelled = true }
  }, [scopeBarangayId, tick])

  // Sitio list: the barangay types its official sitios first; residents then pick from it.
  const [sitioCount, setSitioCount] = useState<{ barangay: number; count: number } | null>(null)
  useEffect(() => {
    if (scopeBarangayId == null) return
    let cancelled = false
    supabase.from('sitios').select('sitio_id', { count: 'exact', head: true }).eq('barangay_id', scopeBarangayId)
      .then(({ count, error }) => { if (!cancelled && !error) setSitioCount({ barangay: scopeBarangayId, count: count ?? 0 }) })
    return () => { cancelled = true }
  }, [scopeBarangayId, tick])
  const noSitioList = scopeBarangayId != null && sitioCount?.barangay === scopeBarangayId && sitioCount.count === 0
  const noSitio = residents.filter((r) => !(r.sitio ?? '').trim())

  const pending = residents.filter((r) => r.status === 'Pending').length
  const nearlyFull = centers.filter((c) =>
    c.status.toLowerCase() !== 'closed' && c.capacity > 0 && c.occupied / c.capacity >= 0.9)

  const tasks: Task[] = []
  // Listed in the order of the operation: alarm first, then rescue, evacuation, missing.
  if (waitingAlarms) {
    tasks.push({
      key: 'alarms', tone: 'urgent', icon: 'bell', menu: 'disasterEvents',
      title: `${plural(waitingAlarms, 'hazard report needs', 'hazard reports need')} a Yes or No`,
      action: 'Check',
    })
  }
  if (live?.teamAsks) {
    tasks.push({
      key: 'team-asks', tone: 'urgent', icon: 'users-alt', menu: 'dispatch',
      title: `${plural(live.teamAsks, 'barangay rescue needs', 'barangay rescues need')} a team from the municipality`,
      action: 'Send a team',
    })
  }
  if (live?.activeSos) {
    tasks.push({
      key: 'sos', tone: 'urgent', icon: 'light-emergency-on', menu: 'dispatch',
      title: `${plural(live.activeSos, 'SOS call needs', 'SOS calls need')} a ticket`,
      action: 'Answer',
    })
  }
  for (const event of live?.events ?? []) {
    tasks.push({
      key: `event-${event.event_id}`, tone: 'urgent', icon: 'siren-on', menu: 'preemptiveEvacuation',
      title: live?.noReport[event.event_id]
        ? `${event.name}: ${plural(live.noReport[event.event_id], 'household has', 'households have')} not said if they evacuated`
        : `${event.name} is active`,
      action: 'Check',
    })
  }
  if (live?.missing) {
    tasks.push({
      key: 'missing', tone: 'warn', icon: 'search-location', menu: 'rescueReconciliation',
      title: `${plural(live.missing, 'person', 'people')} missing`,
      action: 'View',
    })
  }
  if (nearlyFull.length) {
    tasks.push({
      key: 'full', tone: 'warn', icon: 'building', menu: 'evacCenters',
      title: nearlyFull.length === 1
        ? `${nearlyFull[0].name} almost full`
        : `${nearlyFull.length} centers almost full`,
      action: 'View',
    })
  }
  if (live?.teamsOut) {
    tasks.push({
      key: 'teams', tone: 'info', icon: 'ambulance', menu: 'dispatch',
      title: `${plural(live.teamsOut, 'rescue ticket', 'rescue tickets')} open`,
      action: 'View',
    })
  }
  if (pending) {
    tasks.push({
      key: 'pending', tone: 'info', icon: 'user-check', menu: 'verification',
      title: `${plural(pending, 'resident', 'residents')} to verify`,
      action: 'Verify',
    })
  }

  if (noSitioList) {
    tasks.push({
      key: 'sitio-list', tone: 'warn', icon: 'marker', menu: 'population',
      title: 'Your barangay has no sitio list yet',
      detail: 'Residents can\'t pick their sitio until you add one.',
      action: 'Add sitios',
    })
  }
  if (noSitio.length) {
    tasks.push({
      key: 'no-sitio', tone: 'info', icon: 'marker', menu: 'verification',
      title: `${plural(noSitio.length, 'resident has', 'residents have')} no sitio`,
      detail: `${noSitio.slice(0, 3).map((r) => r.name).join(', ')}${noSitio.length > 3 ? ` and ${noSitio.length - 3} more` : ''}. Set it in each resident's Edit details.`,
      action: 'Open residents',
    })
  }

  return (
    <section className="panel today-panel" aria-labelledby="today-heading">
      <div className="today-head">
        <h3 id="today-heading">To do</h3>
        {!live && <span className="today-loading" role="status">Checking…</span>}
      </div>

      {tasks.length === 0 && live ? (
        <p className="today-clear">
          <Icon name="check" /> All clear
        </p>
      ) : (
        <ul className="today-list">
          {tasks.map((task) => (
            <li key={task.key}>
              <button type="button" className={`today-card tone-${task.tone}`} onClick={() => onOpen(task.menu)}>
                <Icon name={task.icon} className="today-icon" />
                <span className="today-text"><strong>{task.title}</strong>{task.detail && <small className="today-detail">{task.detail}</small>}</span>
                <span className="today-action">{task.action} <Icon name="arrow-small-right" /></span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
