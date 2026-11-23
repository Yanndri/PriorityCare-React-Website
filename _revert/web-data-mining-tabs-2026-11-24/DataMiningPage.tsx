import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Circle, CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet'
import type { LatLngBoundsExpression } from 'leaflet'
import type { EvacuationCenter, Resident } from '../types/dashboard'
import { CORDOVA_MAP_LIMITS } from '../lib/barangayCenters'
import { useScopeBarangay } from '../lib/scope'
import { getEventRegister, type EventRegister } from '../api/disasterEventsApi'
import { getResponseTimes, type TicketTimes } from '../api/dataMiningApi'
import { getRescueReconciliation } from '../api/missingPersonsApi'
import type { MissingPersonReport } from '../utils/rescueReconciliation'
import { ELBOW_DROP, MAX_K, MIN_PER_ZONE, priorityZones, type Zone } from '../utils/priorityZones'
import { centerDemand } from '../utils/centerDemand'
import { VPI_CRITICAL_AT } from '../utils/vpi'
import { RescueReconciliationPanel } from '../components/analytics/RescueReconciliationPanel'
import './DataMiningPage.css'

// Data Mining (Chapter IV / UC-13). Barangay admins see their own barangay; the Super Admin
// sees all of Cordova, or the barangay picked in the scope selector.
// Each analysis leads with its answer in one sentence, then a picture, then the table and the
// method folded under "How this was made" (kept for the panel).
//  1. Priority Zones   - weighted K-means of ASSISTED/CRITICAL households, k by the elbow method
//  2. Center Demand    - expected evacuees per center (nearest open center) vs capacity
//  3. Response Time    - average minutes from SOS ticket opened to each rescue step
//  4. Missing Persons  - rescued vs missing ledger

type TabKey = 'zones' | 'demand' | 'response' | 'missing'
const ZONE_COLORS = ['#dc2626', '#ea580c', '#ca8a04', '#2563eb', '#7c3aed', '#0d9488', '#db2777', '#4b5563']
const DEFAULT_VIEW: [number, number] = [10.2526, 123.9496] // Cordova
const STEPS = [
  { key: 'to_acknowledged', label: 'Accepted', color: '#7c3aed' },
  { key: 'to_en_route', label: 'On the way', color: '#2563eb' },
  { key: 'to_on_scene', label: 'Arrived', color: '#ea580c' },
  { key: 'to_resolved', label: 'Finished', color: '#15803d' },
] as const
type StepKey = (typeof STEPS)[number]['key']

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const average = (values: number[]) => (values.length ? values.reduce((t, v) => t + v, 0) / values.length : null)
const median = (values: number[]) => {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b), m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const minutes = (v: number | null) => (v === null ? '—' : `${v.toFixed(1)} min`)
const stepValues = (list: TicketTimes[], key: StepKey) => list.map((t) => t[key]).filter((v): v is number => v !== null)
// The barangay most of a zone's households live in, to name the zone.
function zonePlace(z: Zone) {
  const count = new Map<string, number>()
  z.households.forEach((h) => count.set(h.barangay, (count.get(h.barangay) ?? 0) + 1))
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
}
const foundAtCenter = (r: MissingPersonReport) => r.status === 'found'
  && (!!r.matched_resident_uid || /^(Checked in at|Matched to)/.test(r.reconciliation_note ?? ''))

function How({ title = 'How this was made', open = false, children }: { title?: string; open?: boolean; children: ReactNode }) {
  return <details className="dm-how" open={open}><summary>{title}</summary><div className="dm-how-in">{children}</div></details>
}
function Answer({ tone, children }: { tone: 'bad' | 'warn' | 'ok' | 'info'; children: ReactNode }) {
  return <div className={`dm-answer dm-${tone}`}>{children}</div>
}

export function DataMiningPage({ residents, centers }: { residents: Resident[]; centers: EvacuationCenter[] }) {
  const scope = useScopeBarangay()
  const [active, setActive] = useState<TabKey>('zones')
  const [visited, setVisited] = useState<TabKey[]>(['zones'])
  function open(key: TabKey) {
    setActive(key)
    setVisited((current) => (current.includes(key) ? current : [...current, key]))
  }

  // Headlines for the four tiles.
  const zones = useMemo(() => priorityZones(residents, centers), [residents, centers])
  const demand = useMemo(() => centerDemand(residents, centers), [residents, centers])
  const [allTimes, setAllTimes] = useState<TicketTimes[] | null>(null)
  const [reports, setReports] = useState<MissingPersonReport[] | null>(null)
  useEffect(() => {
    let live = true
    getResponseTimes(null).then((t) => { if (live) setAllTimes(t) }, () => { if (live) setAllTimes([]) })
    getRescueReconciliation().then((d) => { if (live) setReports(d.reports) }, () => { if (live) setReports([]) })
    return () => { live = false }
  }, [])
  const times = (allTimes ?? []).filter((t) => scope === null || t.barangay_id === scope)
  const scopedReports = (reports ?? []).filter((r) => scope === null || r.barangay_id === scope)
  const over = demand.rows.filter((r) => r.status === 'Over').length
  const tight = demand.rows.filter((r) => r.status === 'Tight').length
  const openMissing = scopedReports.filter((r) => r.status === 'missing').length
  const firstZone = zones.zones[0]

  const tiles: { key: TabKey; label: string; value: string; note: string; tone?: 'bad' | 'warn' }[] = [
    { key: 'zones', label: 'Priority zones', value: zones.k ? plural(zones.k, 'zone', 'zones') : '—',
      note: firstZone ? `Start at ${firstZone.label}${zonePlace(firstZone) ? ` (${zonePlace(firstZone)})` : ''}` : 'No households to group yet' },
    { key: 'demand', label: 'Center demand', value: over ? `${over} over` : tight ? `${tight} tight` : demand.rows.length ? 'Enough room' : '—',
      note: over ? `${plural(tight, 'more is', 'more are')} tight` : `${plural(demand.rows.length, 'center', 'centers')} would be used`, tone: over ? 'bad' : tight ? 'warn' : undefined },
    { key: 'response', label: 'Response time', value: allTimes ? minutes(average(stepValues(times, 'to_on_scene'))) : '…',
      note: 'average to arrive' },
    { key: 'missing', label: 'Missing persons', value: reports ? `${openMissing} open` : '…',
      note: `${scopedReports.filter((r) => r.status === 'found').length} found, ${scopedReports.filter((r) => r.status === 'withdrawn').length} withdrawn`,
      tone: openMissing ? 'warn' : undefined },
  ]

  return (
    <section className="data-mining-page dm-page">
      <div className="panel dm-top">
        <div className="dm-head">
          <h3>Data mining</h3>
          <span className="dm-scope">{scope === null ? 'All of Cordova' : 'Your barangay in scope'}</span>
        </div>
        <div className="dm-tiles" role="tablist" aria-label="Data mining analyses">
          {tiles.map((t) => (
            <button key={t.key} type="button" role="tab" id={`analytics-tab-${t.key}`} aria-selected={active === t.key}
              aria-controls={`analytics-panel-${t.key}`} className={`dm-tile${active === t.key ? ' is-on' : ''}`} onClick={() => open(t.key)}>
              <small>{t.label}</small>
              <strong className={t.tone ?? ''}>{t.value}</strong>
              <span>{t.note}</span>
            </button>
          ))}
        </div>
      </div>
      {(['zones', 'demand', 'response', 'missing'] as const).map((key) => visited.includes(key) && (
        <div key={key} role="tabpanel" id={`analytics-panel-${key}`} aria-labelledby={`analytics-tab-${key}`} hidden={active !== key} className="panel dm-panel">
          {key === 'zones' && <PriorityZonesPanel result={zones} active={active === 'zones'} />}
          {key === 'demand' && <CenterDemandPanel result={demand} />}
          {key === 'response' && <ResponseTimePanel />}
          {key === 'missing' && <MissingPanel reports={reports ? scopedReports : null} />}
        </div>
      ))}
    </section>
  )
}

function FitToData({ bounds, active }: { bounds: LatLngBoundsExpression | null; active: boolean }) {
  const map = useMap()
  const key = JSON.stringify(bounds)
  useEffect(() => {
    if (!active) return
    map.invalidateSize()
    const b = JSON.parse(key) as LatLngBoundsExpression | null
    if (b) map.fitBounds(b, { padding: [30, 30], maxZoom: 16 })
  }, [map, key, active])
  return null
}

// ---------- 1. Priority Zones ----------
function PriorityZonesPanel({ result, active }: { result: ReturnType<typeof priorityZones>; active: boolean }) {
  const { households, zones, elbow, k } = result
  const [picked, setPicked] = useState<number | null>(null)
  const sel = picked !== null && picked < zones.length ? picked : null
  const focus = sel !== null ? zones[sel].households : households
  const bounds: LatLngBoundsExpression | null = focus.length
    ? [[Math.min(...focus.map((h) => h.lat)), Math.min(...focus.map((h) => h.lng))],
       [Math.max(...focus.map((h) => h.lat)), Math.max(...focus.map((h) => h.lng))]]
    : null
  const zoneOf = new Map(zones.flatMap((z, i) => z.households.map((h) => [h.key, i] as const)))
  const a = zones[0]
  const chosenDrop = (() => {
    const i = elbow.findIndex((e) => e.k === k)
    const next = elbow[i + 1]
    return i >= 0 && next && elbow[i].sse > 0 ? Math.round((1 - next.sse / elbow[i].sse) * 100) : null
  })()
  const maxSse = Math.max(1, ...elbow.map((e) => e.sse))

  return <>
    {a ? <Answer tone="bad">
      <p className="dm-big">Send responders to {a.label} first.</p>
      <p>It has <b>{plural(a.critical, 'CRITICAL household', 'CRITICAL households')}</b>, {plural(a.cannotWalk, 'person who cannot', 'people who cannot')} walk,
        and {a.nearestCenter ? <>the nearest open center is {a.nearestCenter.name} ({a.nearestCenter.km.toFixed(1)} km).</> : 'no open center nearby.'}</p>
    </Answer> : <Answer tone="info"><p>No ASSISTED or CRITICAL household has a home pin in this scope yet, so there is nothing to group.</p></Answer>}

    <div className="dm-split">
      <div className="analytics-map dm-map">
        <MapContainer {...CORDOVA_MAP_LIMITS} center={DEFAULT_VIEW} zoom={14} scrollWheelZoom style={{ width: '100%', height: '100%' }}>
          <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <FitToData bounds={bounds} active={active} />
          {zones.map((z, i) => (
            <Circle key={z.label} center={[z.lat, z.lng]} radius={z.radiusKm * 1000 + 30}
              pathOptions={{ color: ZONE_COLORS[i % ZONE_COLORS.length], weight: sel === i ? 4 : 2, fillOpacity: sel === null || sel === i ? 0.12 : 0.03, opacity: sel === null || sel === i ? 1 : 0.35 }}>
              <Tooltip permanent direction="top">{z.label.replace('Zone ', '')}</Tooltip>
            </Circle>
          ))}
          {households.map((h) => {
            const zi = zoneOf.get(h.key) ?? 0
            const dim = sel !== null && sel !== zi
            return (
              <CircleMarker key={h.key} center={[h.lat, h.lng]} radius={h.score >= VPI_CRITICAL_AT ? 8 : 6}
                pathOptions={{ color: '#ffffff', weight: 2, fillColor: ZONE_COLORS[zi % ZONE_COLORS.length], fillOpacity: dim ? 0.25 : 1, opacity: dim ? 0.3 : 1 }}>
                <Tooltip>{h.name} ({h.barangay}) · VPI {h.score} {h.priority}</Tooltip>
              </CircleMarker>
            )
          })}
        </MapContainer>
      </div>
      <div className="dm-zones">
        {zones.map((z, i) => (
          <button key={z.label} type="button" className={`dm-zone${sel === i ? ' is-on' : ''}`} aria-pressed={sel === i} onClick={() => setPicked(sel === i ? null : i)}>
            <i className="dm-dot" style={{ background: ZONE_COLORS[i % ZONE_COLORS.length] }} />
            <span><strong>{z.label}{zonePlace(z) ? ` · ${zonePlace(z)}` : ''}</strong>
              <small>{z.critical} CRITICAL · {z.cannotWalk} cannot walk · {z.nearestCenter ? `${z.nearestCenter.km.toFixed(1)} km to ${z.nearestCenter.name}` : 'no open center'}</small></span>
            <span className="dm-n">{z.households.length} hh</span>
          </button>
        ))}
        {zones.length > 0 && <p className="dm-note">{sel === null ? 'Click a zone to highlight it on the map and list its households.' : 'Click it again to show all zones.'}</p>}
        {sel !== null && <ul className="dm-hh">
          {[...zones[sel].households].sort((x, y) => y.score - x.score).map((h) =>
            <li key={h.key}><span>{h.name}</span><span className={h.score >= VPI_CRITICAL_AT ? 'dm-crit' : 'dm-assist'}>VPI {h.score}</span></li>)}
        </ul>}
      </div>
    </div>
    <p className="dm-note">Big dots are CRITICAL households, small dots ASSISTED. The circle around a zone reaches its farthest household.</p>

    {zones.length > 0 && <How title="Zone table">
      <div className="dm-tbl"><table className="catchment-table">
        <thead><tr><th>Zone</th><th>Households</th><th>CRITICAL</th><th>People</th><th>Cannot walk</th><th>Need help walking</th><th>Mean VPI</th><th>Size</th><th>Nearest open center</th></tr></thead>
        <tbody>{zones.map((z) => <tr key={z.label}>
          <td><strong>{z.label}</strong></td><td>{z.households.length}</td><td>{z.critical}</td><td>{z.people}</td><td>{z.cannotWalk}</td><td>{z.needsHelp}</td><td>{z.meanVpi}</td>
          <td>{z.radiusKm < 1 ? `${Math.round(z.radiusKm * 1000)} m` : `${z.radiusKm.toFixed(1)} km`} across</td>
          <td>{z.nearestCenter ? `${z.nearestCenter.name} (${z.nearestCenter.km.toFixed(1)} km)` : 'No open center'}</td></tr>)}</tbody>
      </table></div>
    </How>}

    <How title="How the zones were made (for the panel)" open>
      <p className="dm-note">
        Households scored ASSISTED or CRITICAL (VPI 40+) with a home pin are grouped into zones with weighted K-means
        (weight = VPI score). The number of zones k comes from the elbow method: k goes up from 1 to {MAX_K} (and at most one
        zone per {MIN_PER_ZONE} households) and stops when one more zone lowers the error by less than {Math.round(ELBOW_DROP * 100)}%.
        Zone A has the most CRITICAL households.
      </p>
      {elbow.length > 1 && <>
        <div className="dm-elbow" aria-label="Elbow method: error for each k">
          {elbow.map((e) => <div key={e.k} className="dm-elbow-row">
            <span>{e.k === k ? <b>k = {e.k}</b> : `k = ${e.k}`}</span>
            <span className="dm-elbow-track"><i className={e.k === k ? 'pick' : ''} style={{ width: `${(e.sse / maxSse) * 100}%` }} /></span>
            <span className="dm-num">{e.k === k ? <b>{Math.round(e.sse)}</b> : Math.round(e.sse)}</span>
          </div>)}
        </div>
        <p className="dm-note">SSE is the VPI-weighted sum of squared distances (km²) from each household to its zone center.
          {chosenDrop !== null && ` From ${k} to ${k + 1} zones the error drops only ${chosenDrop}%, so k = ${k}.`}</p>
      </>}
    </How>
  </>
}

// ---------- 2. Center Demand ----------
function CenterDemandPanel({ result }: { result: ReturnType<typeof centerDemand> }) {
  const { rows, noPin } = result
  const sorted = [...rows].sort((a, b) => (b.use ?? -1) - (a.use ?? -1))
  const overRows = sorted.filter((r) => r.status === 'Over')
  const worst = overRows[0]
  const tight = rows.filter((r) => r.status === 'Tight').length
  const scaleMax = Math.max(1, ...rows.map((r) => Math.max(r.expected, r.capacity || 0)))

  return <>
    {!rows.length ? <Answer tone="info"><p>No open evacuation center with a map location in this scope yet.</p></Answer>
      : worst ? <Answer tone="bad"><p><b>{plural(overRows.length, 'center would', 'centers would')} overflow</b> if everyone went to their nearest center.
        {' '}{worst.name} would need {Math.max(0, worst.expected - worst.capacity)} more spaces.{tight ? ` ${plural(tight, 'more is', 'more are')} tight (80%+).` : ''}</p></Answer>
      : tight ? <Answer tone="warn"><p><b>{plural(tight, 'center is', 'centers are')} tight</b> (80% or more full) if everyone went to their nearest center. None would overflow.</p></Answer>
      : <Answer tone="ok"><p><b>Every center has enough room</b> if everyone went to their nearest open center.</p></Answer>}

    {rows.length > 0 && <>
      <div className="dm-bars" aria-label="Expected evacuees compared with capacity">
        {sorted.map((r) => <div key={r.id} className="dm-bar-row">
          <span className="dm-bar-name">{r.name}</span>
          <span className="dm-track" title={`${r.expected} expected · room for ${r.capacity || '—'}`}>
            <i className={`dm-fill ${r.status === 'Over' ? 'over' : r.status === 'Tight' ? 'tight' : ''}`} style={{ width: `${(r.expected / scaleMax) * 100}%` }} />
            {r.capacity > 0 && <i className="dm-cap" style={{ left: `${(r.capacity / scaleMax) * 100}%` }} />}
          </span>
          <span className="dm-num">{r.use === null ? '—' : `${Math.round(r.use * 100)}%`}</span>
        </div>)}
      </div>
      <div className="dm-legend"><span><i style={{ background: '#b91c1c' }} />Over</span><span><i style={{ background: '#d97706' }} />Tight (80%+)</span><span><i style={{ background: '#15803d' }} />Enough</span><span><i className="dm-legend-cap" />Room for</span></div>
    </>}
    {noPin > 0 && <p className="dm-note">{plural(noPin, 'household has', 'households have')} no home pin and {noPin === 1 ? 'is' : 'are'} not counted.</p>}

    {rows.length > 0 && <How title="Center table">
      <div className="dm-tbl"><table className="catchment-table">
        <thead><tr><th>Center</th><th>Households from</th><th>Households</th><th>Expected evacuees</th><th>Need help</th><th>Capacity</th><th>Use</th><th>Status</th></tr></thead>
        <tbody>{sorted.map((r) => <tr key={r.id}>
          <td><strong>{r.name}</strong></td><td>{r.barangays.join(', ')}</td><td>{r.households}</td><td>{r.expected}</td><td>{r.needHelp}</td>
          <td>{r.capacity || '—'}</td><td>{r.use === null ? '—' : `${Math.round(r.use * 100)}%`}</td>
          <td><strong className={`dm-status-${r.status === 'Over' ? 'over' : r.status === 'Tight' ? 'tight' : r.status === 'Enough' ? 'ok' : 'none'}`}>{r.status}</strong></td></tr>)}</tbody>
      </table></div>
    </How>}
    <How>
      <p className="dm-note">Every household is counted at its nearest open evacuation center (the same rule the app uses to send people).
        For each center: the people expected, how many of them cannot walk or need help walking, and use = expected ÷ capacity.
        Over is above 100%, Tight is 80% or more.</p>
    </How>
  </>
}

// ---------- 3. Response Time ----------
function ResponseTimePanel() {
  const scope = useScopeBarangay()
  const [eventId, setEventId] = useState('')
  const [register, setRegister] = useState<EventRegister | null>(null)
  const [tickets, setTickets] = useState<TicketTimes[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { getEventRegister().then(setRegister, () => setRegister(null)) }, [])
  useEffect(() => {
    let live = true
    getResponseTimes(eventId || null).then((t) => { if (live) setTickets(t) }, (e: unknown) => { if (live) setError(e instanceof Error ? e.message : 'Unable to load response times.') })
    return () => { live = false }
  }, [eventId])

  const rows = useMemo(() => (tickets ?? []).filter((t) => scope === null || t.barangay_id === scope), [tickets, scope])
  const priorities = [...new Set(rows.map((t) => t.priority))]
  // Average minutes at each step, then the time spent between steps for the timeline.
  const avg = STEPS.map((s) => average(stepValues(rows, s.key)))
  const segments = STEPS.map((s, i) => {
    const prev = i === 0 ? 0 : avg.slice(0, i).reduce<number>((m, v) => (v !== null ? v : m), 0)
    return { ...s, minutes: avg[i] === null ? null : Math.max(0, avg[i]! - prev) }
  })
  const known = segments.filter((s) => s.minutes !== null && s.minutes > 0)
  const slowest = known.length ? known.reduce((m, s) => (s.minutes! > m.minutes! ? s : m)) : null
  const arrive = avg[2]

  return <>
    <div className="analytics-toolbar dm-toolbar">
      <label>Disaster
        <select value={eventId} onChange={(e) => { setTickets(null); setError(''); setEventId(e.target.value) }}>
          <option value="">All rescues</option>
          {(register?.events ?? []).map((ev) => <option key={ev.event_id} value={ev.event_id}>{ev.name}</option>)}
        </select>
      </label>
    </div>
    {error && <p role="alert" className="dashboard-error">{error}</p>}
    {!tickets && !error && <p role="status">Loading response times…</p>}
    {tickets && (!rows.length
      ? <Answer tone="info"><p>No rescue tickets with a full status log in this scope yet.</p></Answer>
      : <Answer tone="info"><p>A responder arrives <b>{minutes(arrive)}</b> after the ticket opens, on average
        ({plural(rows.length, 'rescue', 'rescues')}).{slowest ? ` The longest step is "${slowest.label}" (${minutes(slowest.minutes)}).` : ''}</p></Answer>)}

    {tickets && rows.length > 0 && <>
      <div className="dm-timeline" aria-label="Average minutes spent on each step">
        {segments.map((s) => s.minutes !== null && s.minutes > 0 && (
          <div key={s.key} style={{ flex: s.minutes, background: s.color }} title={`${s.label}: ${minutes(s.minutes)}`}>{s.minutes.toFixed(1)}</div>
        ))}
      </div>
      <div className="dm-tl-labels"><span>Opened</span>{STEPS.map((s) => <span key={s.key}>{s.label}</span>)}</div>
      <p className="dm-note">Each block is the average minutes spent before reaching that step.</p>
      <div className="dm-tbl"><table className="catchment-table">
        <thead><tr><th>Step (from opened)</th><th>Tickets</th><th>Average</th><th>Median</th>{priorities.map((p) => <th key={p}>Average, {p}</th>)}</tr></thead>
        <tbody>{STEPS.map((s) => {
          const all = stepValues(rows, s.key)
          return <tr key={s.key}><td><strong>{s.label}</strong></td><td>{all.length}</td><td>{minutes(average(all))}</td><td>{minutes(median(all))}</td>
            {priorities.map((p) => <td key={p}>{minutes(average(stepValues(rows.filter((t) => t.priority === p), s.key)))}</td>)}</tr>
        })}</tbody>
      </table></div>
    </>}
    <How>
      <p className="dm-note">For each SOS rescue ticket, the minutes from the ticket being opened to the first time it reached each step,
        taken from the ticket's status log. The table shows the average and the median (middle value) per step.
        Old demo tickets without an "opened" log entry are left out.</p>
    </How>
  </>
}

// ---------- 4. Missing Persons ----------
function MissingPanel({ reports }: { reports: MissingPersonReport[] | null }) {
  if (!reports) return <p role="status">Loading missing-person reports…</p>
  const open = reports.filter((r) => r.status === 'missing').length
  const atCenter = reports.filter(foundAtCenter).length
  const elsewhere = reports.filter((r) => r.status === 'found').length - atCenter
  const withdrawn = reports.filter((r) => r.status === 'withdrawn').length
  const rows = [
    { label: 'Found at a center', value: atCenter, cls: 'ok' },
    { label: 'Found elsewhere', value: elsewhere, cls: 'blue' },
    { label: 'Still missing', value: open, cls: 'over' },
    { label: 'Withdrawn', value: withdrawn, cls: 'grey' },
  ]
  const max = Math.max(1, ...rows.map((r) => r.value))
  return <>
    {!reports.length ? <Answer tone="ok"><p>No missing-person reports in this scope.</p></Answer>
      : open ? <Answer tone="warn"><p><b>{plural(open, 'person is', 'people are')} still missing.</b> {atCenter + elsewhere} found ({atCenter} of them at a center).</p></Answer>
      : <Answer tone="ok"><p><b>No one is missing.</b> All {plural(atCenter + elsewhere, 'report was', 'reports were')} closed as found{withdrawn ? `, ${withdrawn} withdrawn` : ''}.</p></Answer>}
    {reports.length > 0 && <div className="dm-bars">
      {rows.map((r) => <div key={r.label} className="dm-bar-row">
        <span className="dm-bar-name">{r.label}</span>
        <span className="dm-track"><i className={`dm-fill ${r.cls}`} style={{ width: `${(r.value / max) * 100}%` }} /></span>
        <span className="dm-num">{r.value}</span>
      </div>)}
    </div>}
    <p className="dm-note">To work on a report, use Operation › Missing persons.</p>
    <How title="Full ledger and export">
      <RescueReconciliationPanel />
    </How>
  </>
}
