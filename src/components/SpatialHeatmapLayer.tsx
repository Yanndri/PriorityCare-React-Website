import { useEffect, useMemo, useState } from 'react'
import { CircleMarker, Tooltip } from 'react-leaflet'
import { supabase } from '../lib/supabaseClient'
import { getRescueReconciliation } from '../api/missingPersonsApi'
import { getEventRegister } from '../api/disasterEventsApi'
import type { Resident } from '../types/dashboard'
import { INCIDENT_LABELS, incidentPoints, mergePoints, rampColor, vulnerabilityPoints } from '../utils/spatialHeatmap'
import type { HeatLayerKind, IncidentInputs } from '../utils/spatialHeatmap'

// Incidents look back this many hours (evacuations and SOS calls).
const INCIDENT_WINDOW_HOURS = 48

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

// Coloured circles: bigger and darker where more vulnerable residents
// (or incidents) are. The Map page's side panel picks which one to show.
export function SpatialHeatmapLayer({ residents, kind }: { residents: Resident[]; kind: HeatLayerKind }) {
  const [incidents, setIncidents] = useState<IncidentInputs | null>(null)
  useEffect(() => {
    if (kind !== 'incidents' || incidents) return
    let cancelled = false
    loadIncidentInputs().then(r => { if (!cancelled) setIncidents(r.inputs) }).catch(() => undefined)
    return () => { cancelled = true }
  }, [kind, incidents])

  const circles = useMemo(() => {
    if (kind === 'vulnerability') return mergePoints(vulnerabilityPoints(residents, 'all').points)
    if (incidents) return mergePoints(incidentPoints(residents, incidents, INCIDENT_WINDOW_HOURS).points)
    return []
  }, [kind, residents, incidents])

  return <>{circles.map(c => (
    <CircleMarker key={`${kind}-${c.key}`} center={[c.lat, c.lng]}
      radius={10 + 12 * c.intensity}
      pathOptions={{ color: '#ffffff', weight: 2, fillColor: rampColor(kind, 0.35 + 0.65 * c.intensity), fillOpacity: 0.9 }}>
      <Tooltip sticky>
        <strong>{c.count} {kind === 'vulnerability' ? 'vulnerable resident' : 'incident'}{c.count === 1 ? '' : 's'} here</strong>
        {Object.entries(c.kinds).map(([k, n]) => <div key={k}>{INCIDENT_LABELS[k] ?? k}: {n}</div>)}
      </Tooltip>
    </CircleMarker>
  ))}</>
}
