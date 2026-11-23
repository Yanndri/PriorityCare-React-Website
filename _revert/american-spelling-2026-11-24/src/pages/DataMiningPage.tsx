import { useEffect, useMemo, useState } from 'react'
import { Circle, CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet'
import type { LatLngBoundsExpression } from 'leaflet'
import type { EvacuationCenter, Resident } from '../types/dashboard'
import { CORDOVA_MAP_LIMITS } from '../lib/barangayCenters'
import { useScopeBarangay } from '../lib/scope'
import { getEventRegister, type EventRegister } from '../api/disasterEventsApi'
import { getResponseTimes, type TicketTimes } from '../api/dataMiningApi'
import { ELBOW_DROP, MAX_K, MIN_PER_ZONE, priorityZones } from '../utils/priorityZones'
import { centerDemand } from '../utils/centerDemand'
import { VPI_CRITICAL_AT } from '../utils/vpi'
import { RescueReconciliationPanel } from '../components/analytics/RescueReconciliationPanel'
import { AnalyticsBars, AnalyticsCard } from '../components/analytics/AnalyticsWidgets'

// Data Mining (Chapter IV / UC-13). Barangay admins see their own barangay; the Super Admin
// sees all of Cordova, or the barangay picked in the scope selector.
//  1. Priority Zones   - weighted K-means of ASSISTED/CRITICAL households, k by the elbow method
//  2. Center Demand    - expected evacuees per center (nearest open centre) vs capacity
//  3. Response Time    - average minutes from SOS ticket opened to each rescue step
//  4. Missing Persons  - rescued vs missing ledger

const tabs = [
  { key: 'zones', label: 'Priority Zones', title: 'Rescue Priority Zones: K-means clustering of households that need help' },
  { key: 'demand', label: 'Center Demand', title: 'Evacuation Center Demand vs Capacity' },
  { key: 'response', label: 'Response Time', title: 'Rescue Response Time: minutes from SOS to each step' },
  { key: 'missing', label: 'Missing Persons', title: 'Rescued vs. Missing Persons' },
] as const
type TabKey = (typeof tabs)[number]['key']

const ZONE_COLORS = ['#dc2626', '#ea580c', '#ca8a04', '#2563eb', '#7c3aed', '#0d9488', '#db2777', '#4b5563']
const DEFAULT_VIEW: [number, number] = [10.2526, 123.9496] // Cordova

export function DataMiningPage({ residents, centers }: { residents: Resident[]; centers: EvacuationCenter[] }) {
  const [active, setActive] = useState<TabKey>('zones')
  const [visited, setVisited] = useState<TabKey[]>(['zones'])
  function open(key: TabKey) {
    setActive(key)
    setVisited((current) => (current.includes(key) ? current : [...current, key]))
  }
  const current = tabs.find((tab) => tab.key === active)!

  return (
    <section className="data-mining-page">
      <div className="panel mining-intro">
        <div>
          <h3>Data Mining</h3>
          <p>{current.title}</p>
        </div>
      </div>
      <div className="analytics-tabs" role="tablist" aria-label="Data mining analyses">
        {tabs.map((tab) => (
          <button key={tab.key} type="button" role="tab" id={`analytics-tab-${tab.key}`} aria-selected={active === tab.key}
            aria-controls={`analytics-panel-${tab.key}`} className={`analytics-tab ${active === tab.key ? 'active' : ''}`}
            onClick={() => open(tab.key)}>
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab) => visited.includes(tab.key) && (
        <div key={tab.key} role="tabpanel" id={`analytics-panel-${tab.key}`} aria-labelledby={`analytics-tab-${tab.key}`} hidden={active !== tab.key}>
          {tab.key === 'zones' && <PriorityZonesPanel residents={residents} centers={centers} active={active === 'zones'} />}
          {tab.key === 'demand' && <CenterDemandPanel residents={residents} centers={centers} />}
          {tab.key === 'response' && <ResponseTimePanel />}
          {tab.key === 'missing' && <RescueReconciliationPanel />}
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
function PriorityZonesPanel({ residents, centers, active }: { residents: Resident[]; centers: EvacuationCenter[]; active: boolean }) {
  const result = useMemo(() => priorityZones(residents, centers), [residents, centers])
  const { households, zones, elbow, k } = result
  const bounds: LatLngBoundsExpression | null = households.length
    ? [[Math.min(...households.map((h) => h.lat)), Math.min(...households.map((h) => h.lng))],
       [Math.max(...households.map((h) => h.lat)), Math.max(...households.map((h) => h.lng))]]
    : null
  const zoneOf = new Map(zones.flatMap((z, i) => z.households.map((h) => [h.key, i] as const)))

  return (
    <div className="analytics-panel">
      <p className="mining-description">
        Households scored ASSISTED or CRITICAL (VPI 40+) with a home pin are grouped into zones with weighted
        K-means (weight = VPI score). The number of zones k is chosen by the elbow method: k goes up from 1 to {MAX_K}
        (and at most one zone per {MIN_PER_ZONE} households) and stops when one more zone lowers the error by less
        than {Math.round(ELBOW_DROP * 100)}%. Zone A has the most
        CRITICAL households, so responders go there first.
      </p>
      <section className="mining-summary-grid">
        <AnalyticsCard label="Households clustered" value={households.length} note="VPI 40+ with a home pin" />
        <AnalyticsCard label="Zones (k)" value={k || '—'} note="picked by the elbow method" />
        <AnalyticsCard label="CRITICAL households" value={households.filter((h) => h.score >= VPI_CRITICAL_AT).length} note={`VPI ${VPI_CRITICAL_AT}+`} />
        <AnalyticsCard label="Cannot walk" value={households.reduce((t, h) => t + h.counts.nonAmbulatoryCount, 0)} note="people in these households" />
      </section>
      {!households.length && <p className="mining-description">No ASSISTED or CRITICAL household has a home pin in this scope yet.</p>}

      <div className="analytics-map">
        <MapContainer {...CORDOVA_MAP_LIMITS} center={DEFAULT_VIEW} zoom={14} scrollWheelZoom style={{ width: '100%', height: '100%' }}>
          <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <FitToData bounds={bounds} active={active} />
          {zones.map((z, i) => (
            <Circle key={z.label} center={[z.lat, z.lng]} radius={z.radiusKm * 1000 + 30}
              pathOptions={{ color: ZONE_COLORS[i % ZONE_COLORS.length], weight: 2, fillOpacity: 0.12 }}>
              <Tooltip permanent direction="top">{z.label}</Tooltip>
            </Circle>
          ))}
          {households.map((h) => {
            const color = ZONE_COLORS[(zoneOf.get(h.key) ?? 0) % ZONE_COLORS.length]
            return (
              <CircleMarker key={h.key} center={[h.lat, h.lng]} radius={h.score >= VPI_CRITICAL_AT ? 8 : 6}
                pathOptions={{ color: '#ffffff', weight: 2, fillColor: color, fillOpacity: 1 }}>
                <Tooltip>{h.name} ({h.barangay}) · VPI {h.score} {h.priority}</Tooltip>
              </CircleMarker>
            )
          })}
        </MapContainer>
      </div>
      <p className="analytics-legend">Big dots are CRITICAL households, small dots ASSISTED. The circle around a zone reaches its farthest household.</p>

      {zones.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table className="catchment-table">
            <thead>
              <tr><th>Zone</th><th>Households</th><th>CRITICAL</th><th>People</th><th>Cannot walk</th><th>Need help walking</th><th>Mean VPI</th><th>Size</th><th>Nearest open center</th></tr>
            </thead>
            <tbody>
              {zones.map((z) => (
                <tr key={z.label}>
                  <td><strong>{z.label}</strong></td>
                  <td>{z.households.length}</td>
                  <td>{z.critical}</td>
                  <td>{z.people}</td>
                  <td>{z.cannotWalk}</td>
                  <td>{z.needsHelp}</td>
                  <td>{z.meanVpi}</td>
                  <td>{z.radiusKm < 1 ? `${Math.round(z.radiusKm * 1000)} m` : `${z.radiusKm.toFixed(1)} km`} across</td>
                  <td>{z.nearestCenter ? `${z.nearestCenter.name} (${z.nearestCenter.km.toFixed(1)} km)` : 'No open center'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {elbow.length > 1 && (
        <>
          <h4>Elbow method: error (SSE) for each k</h4>
          <AnalyticsBars rows={elbow.map((e) => ({ label: `k = ${e.k}${e.k === k ? '  ← chosen' : ''}`, value: Math.round(e.sse) }))} empty="Not enough households." />
          <p className="mining-description">SSE is the VPI-weighted sum of squared distances (km²) from each household to its zone centre.</p>
        </>
      )}
    </div>
  )
}

// ---------- 2. Center Demand ----------
function CenterDemandPanel({ residents, centers }: { residents: Resident[]; centers: EvacuationCenter[] }) {
  const { rows, noPin } = useMemo(() => centerDemand(residents, centers), [residents, centers])

  return (
    <div className="analytics-panel">
      <p className="mining-description">
        Every household is counted at its nearest open evacuation center (the same rule the app uses to send people).
        For each center: the people expected, how many of them cannot walk or need help walking, and use = expected ÷ capacity.
        Over is above 100%, Tight is 80% or more.
      </p>
      <section className="mining-summary-grid">
        <AnalyticsCard label="Centers that would be used" value={rows.length} note="nearest open center of a household" />
        <AnalyticsCard label="Over capacity" value={rows.filter((r) => r.status === 'Over').length} note="expected above 100%" />
        <AnalyticsCard label="Tight" value={rows.filter((r) => r.status === 'Tight').length} note="80% to 100%" />
        <AnalyticsCard label="Need help to evacuate" value={rows.reduce((t, r) => t + r.needHelp, 0)} note="cannot walk or need help walking" />
      </section>
      {noPin > 0 && <p className="mining-description">{noPin} household{noPin === 1 ? ' has' : 's have'} no home pin and {noPin === 1 ? 'is' : 'are'} not counted.</p>}
      {!rows.length && <p className="mining-description">No open evacuation center with a map location in this scope yet.</p>}
      {rows.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table className="catchment-table">
            <thead><tr><th>Center</th><th>Households from</th><th>Households</th><th>Expected evacuees</th><th>Need help</th><th>Capacity</th><th>Use</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.name}</strong></td>
                  <td>{r.barangays.join(', ')}</td>
                  <td>{r.households}</td>
                  <td>{r.expected}</td>
                  <td>{r.needHelp}</td>
                  <td>{r.capacity || '—'}</td>
                  <td>{r.use === null ? '—' : `${Math.round(r.use * 100)}%`}</td>
                  <td><strong style={{ color: r.status === 'Over' ? '#b91c1c' : r.status === 'Tight' ? '#b45309' : r.status === 'Enough' ? '#15803d' : undefined }}>{r.status}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---------- 3. Response Time ----------
const STEPS = [
  { key: 'to_acknowledged', label: 'Responder accepted' },
  { key: 'to_en_route', label: 'On the way' },
  { key: 'to_on_scene', label: 'Arrived' },
  { key: 'to_resolved', label: 'Rescue finished' },
] as const

const average = (values: number[]) => (values.length ? values.reduce((t, v) => t + v, 0) / values.length : null)
const median = (values: number[]) => {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b), m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const minutes = (v: number | null) => (v === null ? '—' : `${v.toFixed(1)} min`)

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
  const stepValues = (list: TicketTimes[], key: (typeof STEPS)[number]['key']) =>
    list.map((t) => t[key]).filter((v): v is number => v !== null)

  return (
    <div className="analytics-panel">
      <p className="mining-description">
        For each SOS rescue ticket, the minutes from the ticket being opened to the first time it reached each step,
        taken from the ticket's status log. The table shows the average and the median (middle value) per step.
        Old demo tickets without an "opened" log entry are left out.
      </p>
      <div className="analytics-toolbar">
        <label>Disaster
          <select value={eventId} onChange={(e) => { setTickets(null); setError(''); setEventId(e.target.value) }}>
            <option value="">All rescues</option>
            {(register?.events ?? []).map((ev) => <option key={ev.event_id} value={ev.event_id}>{ev.name}</option>)}
          </select>
        </label>
      </div>
      {error && <p role="alert" className="dashboard-error">{error}</p>}
      {!tickets && !error && <p role="status">Loading response times…</p>}
      {tickets && (
        <>
          <section className="mining-summary-grid">
            <AnalyticsCard label="Rescue tickets" value={rows.length} note="with a full status log" />
            <AnalyticsCard label="Finished" value={stepValues(rows, 'to_resolved').length} note="reached Rescue finished" />
            <AnalyticsCard label="Average to arrive" value={minutes(average(stepValues(rows, 'to_on_scene')))} note="opened → responder arrived" />
            <AnalyticsCard label="Average to finish" value={minutes(average(stepValues(rows, 'to_resolved')))} note="opened → rescue finished" />
          </section>
          {!rows.length && <p className="mining-description">No rescue tickets in this scope yet.</p>}
          {rows.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table className="catchment-table">
                <thead><tr><th>Step</th><th>Tickets</th><th>Average</th><th>Median</th>{priorities.map((p) => <th key={p}>Average, {p} priority</th>)}</tr></thead>
                <tbody>
                  {STEPS.map((s) => {
                    const all = stepValues(rows, s.key)
                    return (
                      <tr key={s.key}>
                        <td><strong>{s.label}</strong></td>
                        <td>{all.length}</td>
                        <td>{minutes(average(all))}</td>
                        <td>{minutes(median(all))}</td>
                        {priorities.map((p) => <td key={p}>{minutes(average(stepValues(rows.filter((t) => t.priority === p), s.key)))}</td>)}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
