import { useEffect, useState } from 'react'
import { useLiveSignal } from '../lib/useLiveSignal'
import { getDispatchBoard } from '../api/dispatchApi'
import { columnOf } from '../utils/dispatch'
import { getRescueReconciliation } from '../api/missingPersonsApi'
import { getPreemptiveBoard } from '../api/preemptiveEvacuationApi'
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
}

type Live = {
  activeSos: number | null
  teamsOut: number | null
  events: { event_id: string; name: string }[] | null
  missing: number | null
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
      const [dispatch, reconciliation] = await Promise.allSettled([getDispatchBoard(), getRescueReconciliation()])
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
        noReport,
      })
    })()
    return () => { cancelled = true }
  }, [scopeBarangayId, tick])

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
                <strong className="today-text">{task.title}</strong>
                <span className="today-action">{task.action} <Icon name="arrow-small-right" /></span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
