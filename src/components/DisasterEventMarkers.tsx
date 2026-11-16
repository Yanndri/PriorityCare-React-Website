import { useEffect, useState } from 'react'
import { CircleMarker, Popup } from 'react-leaflet'
import { getEventRegister, hazardLabels } from '../api/disasterEventsApi'
import { useLiveSignal } from '../lib/useLiveSignal'
import type { DisasterEvent } from '../api/disasterEventsApi'

const colors = { flood: '#2563eb', fire: '#dc2626', earthquake: '#c2410c', landslide: '#854d0e' }
export function DisasterEventMarkers() {
  const [events, setEvents] = useState<DisasterEvent[]>([])
  useEffect(() => {
    let cancelled = false
    getEventRegister().then(data => {
      if (!cancelled) setEvents(data.events.filter(event => event.status === 'active'))
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [])
  useLiveSignal(['events'], () => {
    getEventRegister().then(data => setEvents(data.events.filter(event => event.status === 'active'))).catch(() => undefined)
  })
  return <>{events.filter(e => e.latitude !== null && e.longitude !== null).map(event => <CircleMarker key={event.event_id} center={[Number(event.latitude), Number(event.longitude)]} radius={11} pathOptions={{ color: colors[event.hazard_type], fillOpacity: 0.8 }}>
    <Popup><strong>{event.name}</strong><br />{hazardLabels[event.hazard_type]} · Active declaration<br />{event.location_description}<br />Reference point; not a danger-zone boundary.</Popup>
  </CircleMarker>)}</>
}
