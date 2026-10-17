import { useEffect, useMemo, useState } from 'react'
import { CircleMarker, Polyline, Tooltip } from 'react-leaflet'
import { getShelterAssignments } from '../api/shelterPlanApi'
import { catchmentLines, sitioPopulation } from '../utils/shelterCatchments'
import type { ShelterPlanData } from '../utils/shelterCatchments'

/**
 * Geo Map overlay for Module 2.2: each sitio (placed at its residents' average location)
 * linked to its primary shelter (solid) and alternates (dashed). Straight lines, not routes.
 */
export function CatchmentLinesLayer() {
  const [data, setData] = useState<ShelterPlanData | null>(null)
  useEffect(() => {
    let cancelled = false
    // Optional layer: if the migration is missing or the call fails, the map simply omits it.
    getShelterAssignments().then(d => { if (!cancelled) setData(d) }).catch(() => undefined)
    return () => { cancelled = true }
  }, [])
  const { lines } = useMemo(() => data ? catchmentLines(data) : { lines: [] }, [data])
  if (!data || !lines.length) return null
  const sitios = new Map(data.sitios.map(s => [s.sitio_id, s]))
  const anchors = [...new Map(lines.map(l => [l.sitioId, l.from])).entries()]
  return <>
    {lines.map(l => <Polyline key={l.key} positions={[l.from, l.to]} interactive
      pathOptions={{ color: l.role === 'primary' ? '#183153' : '#64748b', weight: l.role === 'primary' ? 3 : 2, opacity: 0.8, dashArray: l.role === 'primary' ? undefined : '6 6' }}>
      <Tooltip sticky>{l.sitioName} → {l.centerName} ({l.role}) · {l.distanceKm.toFixed(2)} km straight-line</Tooltip>
    </Polyline>)}
    {anchors.map(([id, pos]) => {
      const s = sitios.get(id)
      return <CircleMarker key={`sitio-${id}`} center={pos} radius={7} pathOptions={{ color: '#ffffff', weight: 2, fillColor: '#183153', fillOpacity: 1 }}>
        <Tooltip direction="top" offset={[0, -6]}>{s?.sitio_name} · {s ? sitioPopulation(s) : 0} people · catchment centre (average resident location)</Tooltip>
      </CircleMarker>
    })}
  </>
}
