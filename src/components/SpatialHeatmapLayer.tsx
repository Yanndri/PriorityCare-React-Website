import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { CircleMarker, Rectangle, Tooltip, useMap } from 'react-leaflet'
import * as L from 'leaflet'
import { supabase } from '../lib/supabaseClient'
import { getRescueReconciliation } from '../api/missingPersonsApi'
import { getEventRegister } from '../api/disasterEventsApi'
import type { Resident } from '../types/dashboard'
import {
  gridCells, HEAT_RAMPS, INCIDENT_LABELS, incidentPoints, mergePoints, rampColor, vulnerabilityPoints,
} from '../utils/spatialHeatmap'
import type { HeatLayerKind, HeatPoint, IncidentInputs, VulnerabilityFilter } from '../utils/spatialHeatmap'
import './SpatialHeatmapLayer.css'

type LayerChoice = 'off' | HeatLayerKind
type StyleChoice = 'circles' | 'grid'
type WindowChoice = '24' | '48' | '168' | 'all'

const GRID_CELL_METERS = 250

/** A DOM node inside Leaflet's top-right control corner for a React portal. */
function useMapControl() {
  const map = useMap()
  const [host] = useState(() => {
    const div = L.DomUtil.create('div', 'leaflet-control heatmap-control') as HTMLDivElement
    L.DomEvent.disableClickPropagation(div)
    L.DomEvent.disableScrollPropagation(div)
    return div
  })
  useEffect(() => {
    const corner = map.getContainer().querySelector('.leaflet-top.leaflet-right') ?? map.getContainer()
    corner.appendChild(host)
    return () => { host.remove() }
  }, [map, host])
  return host
}

type IncidentState = { inputs: IncidentInputs | null; warnings: string[]; loading: boolean }

async function loadIncidentInputs(): Promise<{ inputs: IncidentInputs; warnings: string[] }> {
  const warnings: string[] = []
  const [recon, register, sos] = await Promise.allSettled([
    getRescueReconciliation(),
    getEventRegister(),
    supabase.from('sos_alerts').select('resident_uid,alert_level,status,created_at').eq('status', 'active').limit(5000),
  ])
  const inputs: IncidentInputs = { latestStatus: [], openReports: [], sosAlerts: [], events: [] }
  if (recon.status === 'fulfilled') {
    inputs.latestStatus = recon.value.residents.map(r => ({ uid: r.uid, status: r.latest_status, loggedAt: r.latest_logged_at }))
    inputs.openReports = recon.value.reports.filter(r => r.status === 'missing').map(r => ({ residentUid: r.resident_uid }))
  } else warnings.push(`Evacuation outcomes / missing reports unavailable: ${recon.reason instanceof Error ? recon.reason.message : 'error'}`)
  if (register.status === 'fulfilled') {
    inputs.events = register.value.events.map(e => ({
      lat: e.latitude === null ? null : Number(e.latitude), lng: e.longitude === null ? null : Number(e.longitude), status: e.status,
    }))
  } else warnings.push('Disaster events unavailable.')
  if (sos.status === 'fulfilled' && !sos.value.error) {
    type SosRow = { resident_uid: unknown; alert_level: unknown; status: string | null; created_at: string | null }
    inputs.sosAlerts = ((sos.value.data ?? []) as SosRow[]).map(a => ({
      residentUid: String(a.resident_uid), level: Number(a.alert_level), status: a.status, createdAt: a.created_at,
    }))
  } else warnings.push('SOS alerts unavailable.')
  return { inputs, warnings }
}

export function SpatialHeatmapLayer({ residents }: { residents: Resident[] }) {
  const host = useMapControl()
  const [layer, setLayer] = useState<LayerChoice>('off')
  const [style, setStyle] = useState<StyleChoice>('circles')
  const [windowChoice, setWindowChoice] = useState<WindowChoice>('48')
  const [vulnFilter, setVulnFilter] = useState<VulnerabilityFilter>('all')
  const [collapsed, setCollapsed] = useState(false)
  const [incidents, setIncidents] = useState<IncidentState>({ inputs: null, warnings: [], loading: false })

  // Incidents are fetched on demand (first time the layer is chosen, or on refresh), not on every render.
  function fetchIncidents() {
    setIncidents(s => ({ ...s, loading: true }))
    loadIncidentInputs()
      .then(({ inputs, warnings }) => setIncidents({ inputs, warnings, loading: false }))
      .catch(e => setIncidents({ inputs: null, warnings: [e instanceof Error ? e.message : 'Unable to load incidents.'], loading: false }))
  }
  function chooseLayer(v: LayerChoice) {
    setLayer(v)
    if (v === 'incidents' && !incidents.inputs && !incidents.loading) fetchIncidents()
  }

  const result = useMemo(() => {
    if (layer === 'vulnerability') return vulnerabilityPoints(residents, vulnFilter)
    if (layer === 'incidents' && incidents.inputs) {
      return { ...incidentPoints(residents, incidents.inputs, windowChoice === 'all' ? null : Number(windowChoice)), incomplete: 0 }
    }
    return { points: [] as HeatPoint[], unmapped: 0, incomplete: 0 }
  }, [layer, residents, vulnFilter, incidents.inputs, windowChoice])

  const cells = useMemo(() => style === 'grid' ? gridCells(result.points, GRID_CELL_METERS) : [], [style, result.points])
  const circles = useMemo(() => style === 'circles' ? mergePoints(result.points) : [], [style, result.points])
  const kind: HeatLayerKind = layer === 'incidents' ? 'incidents' : 'vulnerability'
  const breakdown = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const p of result.points) counts[p.kind] = (counts[p.kind] ?? 0) + 1
    return Object.entries(counts).sort((a, b) => b[1] - a[1])
  }, [result.points])

  const panel = createPortal(
    <div className="heatmap-panel" role="region" aria-label="Heatmap layers">
      <div className="heatmap-panel-head">
        <strong>Heatmaps</strong>
        <button type="button" onClick={() => setCollapsed(c => !c)} aria-expanded={!collapsed}>{collapsed ? 'Show' : 'Hide'}</button>
      </div>
      {!collapsed && <>
        <div className="heatmap-segment" role="group" aria-label="Layer">
          {(['off', 'vulnerability', 'incidents'] as const).map(v => (
            <button key={v} type="button" aria-pressed={layer === v} onClick={() => chooseLayer(v)}>
              {v === 'off' ? 'Off' : v === 'vulnerability' ? 'Vulnerability' : 'Incidents'}
            </button>))}
        </div>
        {layer !== 'off' && <>
          <div className="heatmap-segment" role="group" aria-label="Style">
            <button type="button" aria-pressed={style === 'circles'} onClick={() => setStyle('circles')}>Circles</button>
            <button type="button" aria-pressed={style === 'grid'} onClick={() => setStyle('grid')}>Grid</button>
          </div>
          {layer === 'vulnerability'
            ? <label className="heatmap-field">Residents
              <select value={vulnFilter} onChange={e => setVulnFilter(e.target.value as VulnerabilityFilter)}>
                <option value="all">All with a VPI score</option>
                <option value="moderate-high">Moderate + high VPI</option>
                <option value="high">High VPI only</option>
              </select></label>
            : <label className="heatmap-field">Evacuation & SOS window
              <select value={windowChoice} onChange={e => setWindowChoice(e.target.value as WindowChoice)}>
                <option value="24">Last 24 hours</option>
                <option value="48">Last 48 hours</option>
                <option value="168">Last 7 days</option>
                <option value="all">All time</option>
              </select></label>}
          <div className="heatmap-legend" aria-hidden="true">
            <span className="heatmap-ramp" style={{ background: `linear-gradient(90deg, ${HEAT_RAMPS[kind].join(', ')})` }} />
            <span className="heatmap-ramp-labels"><span>Lower</span><span>Higher {layer === 'vulnerability' ? 'vulnerability' : 'incident'} intensity</span></span>
          </div>
          {layer === 'incidents' && incidents.loading && <p className="heatmap-note" role="status">Loading incidents…</p>}
          <p className="heatmap-note" role="status">
            {result.points.length} point{result.points.length === 1 ? '' : 's'} mapped
            {style === 'grid' && cells.length > 0 && ` in ${cells.length} cell${cells.length === 1 ? '' : 's'} (${GRID_CELL_METERS} m)`}
            {result.unmapped > 0 && ` · ${result.unmapped} without GPS`}
            {layer === 'vulnerability' && result.incomplete > 0 && ` · ${result.incomplete} incomplete VPI (known factors only)`}
          </p>
          {breakdown.length > 0 && <ul className="heatmap-breakdown">
            {breakdown.map(([k, n]) => <li key={k}><span>{INCIDENT_LABELS[k] ?? k}</span><strong>{n}</strong></li>)}
          </ul>}
          {layer === 'incidents' && incidents.warnings.map(w => <p key={w} className="heatmap-warning">{w}</p>)}
          <p className="heatmap-note">
            {layer === 'vulnerability'
              ? 'Weighted by prototype VPI (age, mobility/disability, pregnancy) at registered home locations.'
              : 'Resident incidents use registered home locations. Open missing reports and active disaster events are always shown.'}
          </p>
          {layer === 'incidents' && <button type="button" className="heatmap-refresh" disabled={incidents.loading} onClick={fetchIncidents}>Refresh incidents</button>}
        </>}
      </>}
    </div>,
    host,
  )

  return <>
    {panel}
    {layer !== 'off' && style === 'circles' && circles.map(c => (
      <CircleMarker key={`${layer}-${c.key}`} center={[c.lat, c.lng]}
        radius={10 + 12 * c.intensity}
        pathOptions={{ color: '#ffffff', weight: 2, fillColor: rampColor(kind, 0.35 + 0.65 * c.intensity), fillOpacity: 0.9 }}>
        <Tooltip sticky>
          <strong>{c.count} {layer === 'vulnerability' ? 'vulnerable resident' : 'incident'}{c.count === 1 ? '' : 's'} here</strong>
          {Object.entries(c.kinds).map(([k, n]) => <div key={k}>{INCIDENT_LABELS[k] ?? k}: {n}</div>)}
          <div>Relative intensity: {Math.round(c.intensity * 100)}%</div>
        </Tooltip>
      </CircleMarker>
    ))}
    {layer !== 'off' && style === 'grid' && cells.map(c => (
      <Rectangle key={`${layer}-${c.key}`} bounds={[[c.south, c.west], [c.north, c.east]]}
        pathOptions={{ color: '#ffffff', weight: 1, fillColor: rampColor(kind, 0.2 + 0.8 * c.intensity), fillOpacity: 0.65 }}>
        <Tooltip sticky>
          <strong>{c.count} {layer === 'vulnerability' ? 'vulnerable resident' : 'incident'}{c.count === 1 ? '' : 's'}</strong>
          {Object.entries(c.kinds).map(([k, n]) => <div key={k}>{INCIDENT_LABELS[k] ?? k}: {n}</div>)}
          <div>Relative intensity: {Math.round(c.intensity * 100)}%</div>
        </Tooltip>
      </Rectangle>
    ))}
  </>
}
