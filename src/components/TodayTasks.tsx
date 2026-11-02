import { useEffect, useState } from 'react'
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
  detail: string
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
  }, [scopeBarangayId])

  const pending = residents.filter((r) => r.status === 'Pending').length
  const nearlyFull = centers.filter((c) =>
    c.status.toLowerCase() !== 'closed' && c.capacity > 0 && c.occupied / c.capacity >= 0.9)

  const tasks: Task[] = []
  if (live?.activeSos) {
    tasks.push({
      key: 'sos', tone: 'urgent', icon: 'sos', menu: 'dispatch',
      title: `${plural(live.activeSos, 'person is', 'people are')} asking for help (SOS)`,
      detail: 'Open a rescue request and send a team.',
      action: 'Answer SOS',
    })
  }
  for (const event of live?.events ?? []) {
    tasks.push({
      key: `event-${event.name}`, tone: 'urgent', icon: 'siren-on', menu: 'preemptiveEvacuation',
      title: `Disaster declared: ${event.name}`,
      detail: live?.noEvacuationReport
        ? `${plural(live.noEvacuationReport, 'household has', 'households have')} not said yet if they are evacuating.`
        : 'Check which households are evacuating and where they are going.',
      action: 'Check evacuations',
    })
  }
  if (live?.missing) {
    tasks.push({
      key: 'missing', tone: 'warn', icon: 'search-location', menu: 'rescueReconciliation',
      title: `${plural(live.missing, 'person is', 'people are')} reported missing`,
      detail: 'Mark them found when they turn up, or send a team to look.',
      action: 'See missing persons',
    })
  }
  if (nearlyFull.length) {
    tasks.push({
      key: 'full', tone: 'warn', icon: 'building', menu: 'evacCenters',
      title: `${plural(nearlyFull.length, 'evacuation center is', 'evacuation centers are')} almost full`,
      detail: nearlyFull.map((c) => `${c.name} (${c.occupied} of ${c.capacity})`).join(', '),
      action: 'See centers',
    })
  }
  if (live?.teamsOut) {
    tasks.push({
      key: 'teams', tone: 'info', icon: 'ambulance', menu: 'dispatch',
      title: `${plural(live.teamsOut, 'rescue request is', 'rescue requests are')} still open`,
      detail: 'Follow up until each one is marked resolved.',
      action: 'See rescue teams',
    })
  }
  if (pending) {
    tasks.push({
      key: 'pending', tone: 'info', icon: 'user-check', menu: 'verification',
      title: `${plural(pending, 'resident is', 'residents are')} waiting for verification`,
      detail: 'Check their ID, then verify or reject them.',
      action: 'Verify residents',
    })
  }

  return (
    <section className="panel today-panel" aria-labelledby="today-heading">
      <div className="today-head">
        <h3 id="today-heading">Things to do</h3>
        {!live && <span className="today-loading" role="status">Checking…</span>}
      </div>

      {tasks.length === 0 && live ? (
        <p className="today-clear">
          <Icon name="check" /> All clear. Nothing needs your attention right now.
        </p>
      ) : (
        <ul className="today-list">
          {tasks.map((task) => (
            <li key={task.key}>
              <button type="button" className={`today-card tone-${task.tone}`} onClick={() => onOpen(task.menu)}>
                <Icon name={task.icon} className="today-icon" />
                <span className="today-text">
                  <strong>{task.title}</strong>
                  <span>{task.detail}</span>
                </span>
                <span className="today-action">{task.action} <Icon name="arrow-small-right" /></span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
