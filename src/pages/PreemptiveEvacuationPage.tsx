import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  destinationLabel,
  destinationTypeLabels,
  getPreemptiveBoard,
  getPreemptiveHistory,
  logPreemptiveEvacuation,
  preemptiveStatusLabels,
  statusNeedsDestination,
  type DestinationType,
  type PreemptiveBoard,
  type PreemptiveLog,
  type PreemptiveResident,
  type PreemptiveStatus,
} from '../api/preemptiveEvacuationApi'
import '../components/ShelterCatchmentPanel.css'

// Module: Log Resident Pre-emptive Evacuation Status & Intended Destination.
// Staff log (or residents report from the app) whether a household is staying,
// getting ready, on the way, or has arrived, and where it is going.

type Props = {
  // null = every barangay (super admin "All barangays" scope).
  scopeBarangayId: number | null
}

type StatusFilter = 'all' | 'none' | PreemptiveStatus

type Draft = {
  resident: PreemptiveResident
  eventId: string
  status: PreemptiveStatus
  destinationType: DestinationType
  centerId: string
  destinationAddress: string
  headcount: string
  note: string
}

const statusTone: Record<PreemptiveStatus, string> = {
  staying_home: 'load-near',
  preparing: 'load-near',
  evacuating: 'load-near',
  arrived: 'load-ok',
  returned_home: '',
}

const sourceLabels = { resident: 'resident (app)', staff: 'staff', rescuer: 'rescuer' } as const

const mobilityLabels: Record<string, string> = {
  ambulatory: 'Can walk',
  semi_ambulatory: 'Needs some help',
  non_ambulatory: 'Cannot walk',
}

const formatTime = (iso: string) =>
  new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))

function newDraft(resident: PreemptiveResident, board: PreemptiveBoard): Draft {
  const latest = resident.latest
  const event = board.events.find((e) => e.barangay_id === resident.barangay_id)
  // Start from the household's current report so a follow-up only changes what moved.
  return {
    resident,
    eventId: latest?.event_id ?? event?.event_id ?? '',
    status: latest?.status ?? 'preparing',
    destinationType: latest?.destination_type ?? 'evacuation_center',
    centerId: latest?.destination_center_id ? String(latest.destination_center_id) : '',
    destinationAddress: latest?.destination_address ?? '',
    headcount: String(latest?.headcount ?? resident.household_size),
    note: '',
  }
}

export function PreemptiveEvacuationPage({ scopeBarangayId }: Props) {
  const [board, setBoard] = useState<PreemptiveBoard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [history, setHistory] = useState<{ uid: string; name: string; logs: PreemptiveLog[] } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setBoard(await getPreemptiveBoard(scopeBarangayId))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load evacuation status.')
    } finally {
      setLoading(false)
    }
  }, [scopeBarangayId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    void load()
  }, [load])

  const counts = useMemo(() => {
    const result: Record<StatusFilter, number> = {
      all: 0, none: 0, staying_home: 0, preparing: 0, evacuating: 0, arrived: 0, returned_home: 0,
    }
    for (const r of board?.residents ?? []) {
      result.all += 1
      result[r.latest?.status ?? 'none'] += 1
    }
    return result
  }, [board])

  const shown = useMemo(() => {
    const term = search.trim().toLowerCase()
    return (board?.residents ?? []).filter((r) => {
      if (statusFilter !== 'all' && (r.latest?.status ?? 'none') !== statusFilter) return false
      if (!term) return true
      return [r.name, r.household_name ?? '', r.barangay_name, r.sitio, r.latest ? destinationLabel(r.latest) : '']
        .some((value) => value.toLowerCase().includes(term))
    })
  }, [board, search, statusFilter])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!draft) return
    const withDestination = statusNeedsDestination(draft.status)
    if (withDestination && draft.destinationType === 'evacuation_center' && !draft.centerId) {
      setError('Choose the evacuation center.')
      return
    }
    if (withDestination && draft.destinationType !== 'evacuation_center' && !draft.destinationAddress.trim()) {
      setError('Enter the address or place the household is going to.')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await logPreemptiveEvacuation({
        residentUid: draft.resident.uid,
        eventId: draft.eventId || null,
        status: draft.status,
        destinationType: withDestination ? draft.destinationType : null,
        centerId: draft.centerId ? Number(draft.centerId) : null,
        destinationAddress: draft.destinationAddress,
        headcount: draft.headcount ? Number(draft.headcount) : null,
        note: draft.note,
      })
      setNotice(`${draft.resident.name}: ${preemptiveStatusLabels[draft.status]} logged.`)
      setDraft(null)
      if (history?.uid === draft.resident.uid) setHistory(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to log the evacuation status.')
    } finally {
      setBusy(false)
    }
  }

  async function openHistory(resident: PreemptiveResident) {
    setError('')
    try {
      setHistory({ uid: resident.uid, name: resident.name, logs: await getPreemptiveHistory(resident.uid) })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load the history.')
    }
  }

  const draftEvents = draft && board ? board.events.filter((e) => e.barangay_id === draft.resident.barangay_id) : []
  // The resident's own barangay's centers first, then the rest.
  const draftCenters = draft && board
    ? [...board.centers].sort((a, b) =>
        Number(b.barangay_id === draft.resident.barangay_id) - Number(a.barangay_id === draft.resident.barangay_id))
    : []

  const filterChip = (key: StatusFilter, label: string) => (
    <button
      key={key}
      type="button"
      className={statusFilter === key ? 'verify-button' : 'secondary-button'}
      aria-pressed={statusFilter === key}
      onClick={() => setStatusFilter(key)}
    >
      {label} ({counts[key]})
    </button>
  )

  return <section className="panel catchment-panel">
    <div className="section-header">
      <div><span className="panel-kicker">PRE-EMPTIVE EVACUATION</span><h3>Resident Evacuation Status &amp; Destination</h3></div>
      <button type="button" className="secondary-button" disabled={loading || busy} onClick={() => void load()}>Refresh</button>
    </div>
    <p className="catchment-muted">
      Log whether each household is staying home, preparing to leave, on the way, or has arrived, and where it is going.
      Residents can also report this from the app. When the destination is an evacuation center, "On the way" and "Arrived"
      also update that center's occupancy.
    </p>
    {error && <p role="alert" className="dashboard-error">{error}</p>}
    {notice && <p role="status" className="catchment-notice">{notice}</p>}

    <div className="table-actions" role="group" aria-label="Filter by status">
      {filterChip('all', 'All')}
      {filterChip('none', 'No report yet')}
      {(Object.keys(preemptiveStatusLabels) as PreemptiveStatus[]).map((key) => filterChip(key, preemptiveStatusLabels[key]))}
    </div>
    <div className="filters">
      <input
        type="search"
        placeholder="Search name, household, sitio or destination…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Search residents"
      />
    </div>

    {draft && board && <form className="edit-form-grid" onSubmit={(e) => void submit(e)}>
      <p><strong>Log evacuation status: {draft.resident.name}</strong>
        <br /><small className="catchment-muted">{draft.resident.household_name ?? 'No household'} · {draft.resident.barangay_name}</small></p>
      <label><span>Status</span>
        <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as PreemptiveStatus })}>
          {(Object.keys(preemptiveStatusLabels) as PreemptiveStatus[]).map((key) =>
            <option key={key} value={key}>{preemptiveStatusLabels[key]}</option>)}
        </select></label>
      {statusNeedsDestination(draft.status) && <>
        <label><span>Intended destination</span>
          <select value={draft.destinationType} onChange={(e) => setDraft({ ...draft, destinationType: e.target.value as DestinationType })}>
            {(Object.keys(destinationTypeLabels) as DestinationType[]).map((key) =>
              <option key={key} value={key}>{destinationTypeLabels[key]}</option>)}
          </select></label>
        {draft.destinationType === 'evacuation_center'
          ? <label><span>Evacuation center</span>
              <select required value={draft.centerId} onChange={(e) => setDraft({ ...draft, centerId: e.target.value })}>
                <option value="">Select…</option>
                {draftCenters.map((c) => <option key={c.center_id} value={c.center_id}>
                  {c.center_name}{c.barangay_id === draft.resident.barangay_id ? ' (this barangay)' : ''}</option>)}
              </select></label>
          : <label><span>Address or place</span>
              <input required maxLength={300} value={draft.destinationAddress}
                placeholder={draft.destinationType === 'relative_friend' ? 'e.g. Tita Nena, Purok 2, Pilipog' : 'e.g. Church hall, Poblacion'}
                onChange={(e) => setDraft({ ...draft, destinationAddress: e.target.value })} /></label>}
      </>}
      <label><span>People in this group</span>
        <input type="number" min={1} max={50} value={draft.headcount} onChange={(e) => setDraft({ ...draft, headcount: e.target.value })} /></label>
      <label><span>Disaster event (optional)</span>
        <select value={draft.eventId} onChange={(e) => setDraft({ ...draft, eventId: e.target.value })}>
          <option value="">None (before a declared event)</option>
          {draftEvents.map((ev) => <option key={ev.event_id} value={ev.event_id}>{ev.name}</option>)}
        </select></label>
      <label><span>Note (optional)</span>
        <input maxLength={500} value={draft.note} placeholder="e.g. needs a ride, leaving at 5 PM"
          onChange={(e) => setDraft({ ...draft, note: e.target.value })} /></label>
      <div>
        <button type="submit" className="verify-button" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>{' '}
        <button type="button" className="secondary-button" disabled={busy} onClick={() => setDraft(null)}>Cancel</button>
      </div>
    </form>}

    {history && <div className="catchment-table-wrap">
      <h4 className="catchment-subhead">History: {history.name}{' '}
        <button type="button" className="secondary-button" onClick={() => setHistory(null)}>Close</button></h4>
      {history.logs.length === 0 ? <p className="catchment-muted">No reports yet.</p> : <table className="catchment-table">
        <thead><tr><th>When</th><th>Status</th><th>Destination</th><th>People</th><th>Logged by</th><th>Note</th></tr></thead>
        <tbody>{history.logs.map((log) => <tr key={log.log_id}>
          <td>{formatTime(log.logged_at)}</td>
          <td>{preemptiveStatusLabels[log.status]}</td>
          <td>{destinationLabel(log) || '—'}</td>
          <td>{log.headcount}</td>
          <td>{log.reported_by_name || '—'} <small className="catchment-muted">({sourceLabels[log.source]})</small></td>
          <td>{log.note || '—'}</td>
        </tr>)}</tbody>
      </table>}
    </div>}

    {loading ? <p role="status">Loading residents…</p> : <div className="catchment-table-wrap"><table className="catchment-table">
      <thead><tr><th>Resident / household</th><th>Barangay</th><th>Status</th><th>Intended destination</th><th>Last update</th><th /></tr></thead>
      <tbody>{shown.map((r) => <tr key={r.uid}>
        <td><strong>{r.name}</strong>
          <div className="catchment-muted"><small>
            {r.household_name ?? 'No household'} · {r.household_size} {r.household_size === 1 ? 'person' : 'people'}
            {r.mobility ? ` · ${mobilityLabels[r.mobility] ?? r.mobility}` : ''}
          </small></div></td>
        <td>{r.barangay_name}{r.sitio ? <div className="catchment-muted"><small>{r.sitio}</small></div> : null}</td>
        <td>{r.latest
          ? <span className={`catchment-load ${statusTone[r.latest.status]}`}>{preemptiveStatusLabels[r.latest.status]}</span>
          : <span className="catchment-load load-over">No report yet</span>}</td>
        <td>{r.latest && destinationLabel(r.latest)
          ? <>{destinationLabel(r.latest)}<div className="catchment-muted"><small>
              {r.latest.destination_type ? destinationTypeLabels[r.latest.destination_type] : ''} · {r.latest.headcount} {r.latest.headcount === 1 ? 'person' : 'people'}
            </small></div></>
          : '—'}</td>
        <td>{r.latest
          ? <>{formatTime(r.latest.logged_at)}<div className="catchment-muted"><small>
              by {r.latest.reported_by_name || 'unknown'} ({sourceLabels[r.latest.source]}){r.latest.event_name ? ` · ${r.latest.event_name}` : ''}
            </small></div>{r.latest.note && <div className="catchment-muted"><small>"{r.latest.note}"</small></div>}</>
          : '—'}</td>
        <td>
          <button type="button" className="verify-button" disabled={busy}
            onClick={() => { if (board) { setDraft(newDraft(r, board)); setNotice('') } }}>Log update</button>{' '}
          {r.latest && <button type="button" className="secondary-button" disabled={busy} onClick={() => void openHistory(r)}>History</button>}
        </td>
      </tr>)}</tbody>
    </table>
    {!shown.length && <p className="catchment-muted">{board?.residents.length ? 'No residents match this filter.' : 'No residents in this scope yet.'}</p>}
    </div>}
  </section>
}
