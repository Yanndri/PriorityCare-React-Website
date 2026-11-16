import { useEffect, useState } from 'react'
import { useLiveSignal } from '../lib/useLiveSignal'
import { supabase } from '../lib/supabaseClient'
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
  events: { name: string }[] | null
  missing: number | null
  noEvacuationReport: number | null
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

const OPEN_TICKET_STATUSES = ['open', 'assigned', 'en_route', 'on_scene']

async function countRows(table: 'sos_alerts' | 'dispatch_tickets', statuses: string[], scope: number | null) {
  let query = supabase.from(table).select('*', { count: 'exact', head: true }).in('status', statuses)
  if (scope !== null) query = query.eq('barangay_id', scope)
  const { count, error } = await query
  if (error) throw error
  return count ?? 0
}

export function TodayTasks({ scopeBarangayId, residents, centers, onOpen }: Props) {
  const [live, setLive] = useState<Live | null>(null)
  // Re-count when the app or another admin changes something.
  const [tick, setTick] = useState(0)
  useLiveSignal(['sos', 'tickets', 'events', 'missing', 'preemptive'], () => setTick((n) => n + 1))

  useEffect(() => {
    let cancelled = false
    const value = <T,>(result: PromiseSettledResult<T>) => (result.status === 'fulfilled' ? result.value : null)
    void (async () => {
      const [sos, tickets, reconciliation] = await Promise.allSettled([
        countRows('sos_alerts', ['active'], scopeBarangayId),
        countRows('dispatch_tickets', OPEN_TICKET_STATUSES, scopeBarangayId),
        getRescueReconciliation(),
      ])
      const data = value(reconciliation)
      const inScope = (barangayId: number) => scopeBarangayId === null || barangayId === scopeBarangayId
      const events = data ? data.events.filter((e) => e.status === 'active' && inScope(e.barangay_id)) : null
      // Only chase evacuation reports while a disaster is declared.
      let noEvacuationReport: number | null = null
      if (events?.length) {
        try {
          const board = await getPreemptiveBoard(scopeBarangayId)
          noEvacuationReport = board.residents.filter((r) => !r.latest).length
        } catch {
          noEvacuationReport = null
        }
      }
      if (cancelled) return
      setLive({
        activeSos: value(sos),
        teamsOut: value(tickets),
        events,
        missing: data ? data.reports.filter((r) => r.status === 'missing' && inScope(r.barangay_id)).length : null,
        noEvacuationReport,
      })
    })()
    return () => { cancelled = true }
  }, [scopeBarangayId, tick])

  const pending = residents.filter((r) => r.status === 'Pending').length
  const nearlyFull = centers.filter((c) =>
    c.status.toLowerCase() !== 'closed' && c.capacity > 0 && c.occupied / c.capacity >= 0.9)

  const tasks: Task[] = []
  if (live?.activeSos) {
    tasks.push({
      key: 'sos', tone: 'urgent', icon: 'sos', menu: 'dispatch',
      title: `${plural(live.activeSos, 'SOS', 'SOS calls')} waiting`,
      action: 'Answer',
    })
  }
  for (const event of live?.events ?? []) {
    tasks.push({
      key: `event-${event.name}`, tone: 'urgent', icon: 'siren-on', menu: 'preemptiveEvacuation',
      title: live?.noEvacuationReport
        ? `${event.name}: ${plural(live.noEvacuationReport, 'household', 'households')} with no report yet`
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
      title: `${plural(live.teamsOut, 'rescue', 'rescues')} in progress`,
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
