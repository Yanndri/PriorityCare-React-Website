import { useEffect, useState } from 'react'
import { CircleMarker, Popup } from 'react-leaflet'
import { getHazardReports, HAZARD_STATUS_LABELS, HAZARD_TYPE_LABELS, type HazardReport } from '../api/hazardReportsApi'
import { useLiveSignal } from '../lib/useLiveSignal'

// Open hazards reported from the app. Review them on the SOS & Rescue page.
export function HazardPinsLayer() {
  const [rows, setRows] = useState<HazardReport[]>([])
  useEffect(() => {
    let cancelled = false
    getHazardReports().then((r) => { if (!cancelled) setRows(r) }).catch(() => undefined)
    return () => { cancelled = true }
  }, [])
  useLiveSignal(['hazards'], () => { getHazardReports().then(setRows).catch(() => undefined) })
  const open = rows.filter((r) => ['unverified', 'under_review', 'confirmed'].includes(r.status))
  return <>{open.map((h) => <CircleMarker key={h.hazard_id} center={[h.latitude, h.longitude]} radius={8}
    pathOptions={{ color: h.status === 'confirmed' ? '#b91c1c' : '#d97706', weight: 3, fillColor: '#fde68a', fillOpacity: 0.9, dashArray: h.status === 'confirmed' ? undefined : '4 3' }}>
    <Popup><strong>{HAZARD_TYPE_LABELS[h.hazard_type] ?? h.hazard_type}</strong> · {HAZARD_STATUS_LABELS[h.status]}<br />
      {h.description}<br />Review it on the SOS &amp; Rescue page.</Popup>
  </CircleMarker>)}</>
}
