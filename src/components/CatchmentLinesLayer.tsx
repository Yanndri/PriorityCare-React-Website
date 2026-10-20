import { useEffect, useMemo, useState } from 'react'
import { CircleMarker, Polyline, Tooltip } from 'react-leaflet'
import { getShelterAssignments } from '../api/shelterPlanApi'
import { catchmentLines, barangayPopulation } from '../utils/shelterCatchments'
import type { ShelterPlanData } from '../utils/shelterCatchments'

/**
 * Geo Map overlay for Module 2.2: each barangay (placed at its residents' average location)
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
  // Barangay admins see only their own barangay's catchment; the municipal admin sees all.
  const { lines } = useMemo(() => {
    if (!data) return { lines: [] }
    const mine = new Set(data.barangays.filter(b => data.can_edit_all || b.editable).map(b => b.barangay_id))
    const all = catchmentLines(data)
    return { ...all, lines: all.lines.filter(l => mine.has(l.barangayId)) }
  }, [data])
  if (!data || !lines.length) return null
  const barangays = new Map(data.barangays.map(s => [s.barangay_id, s]))
  const anchors = [...new Map(lines.map(l => [l.barangayId, l.from])).entries()]
  return <>
    {lines.map(l => <Polyline key={l.key} positions={[l.from, l.to]} interactive
      pathOptions={{ color: l.role === 'primary' ? '#183153' : '#64748b', weight: l.role === 'primary' ? 3 : 2, opacity: 0.8, dashArray: l.role === 'primary' ? undefined : '6 6' }}>
      <Tooltip sticky>{l.barangayName} → {l.centerName} ({l.role}) · {l.distanceKm.toFixed(2)} km straight-line</Tooltip>
    </Polyline>)}
    {anchors.map(([id, pos]) => {
      const s = barangays.get(id)
      return <CircleMarker key={`barangay-${id}`} center={pos} radius={7} pathOptions={{ color: '#ffffff', weight: 2, fillColor: '#183153', fillOpacity: 1 }}>
        <Tooltip direction="top" offset={[0, -6]}>{s?.barangay_name} · {s ? barangayPopulation(s) : 0} people · catchment centre (average resident location)</Tooltip>
      </CircleMarker>
    })}
  </>
}
