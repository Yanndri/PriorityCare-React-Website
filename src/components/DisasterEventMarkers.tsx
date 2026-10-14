import { useEffect, useState } from 'react'
import { CircleMarker, Popup, useMap } from 'react-leaflet'
import { getEventRegister, hazardLabels } from '../api/disasterEventsApi'
import type { DisasterEvent } from '../api/disasterEventsApi'

const colors = { flood: '#2563eb', fire: '#dc2626', earthquake: '#c2410c', landslide: '#854d0e' }
export function DisasterEventMarkers() {
  const map = useMap()
  const [events, setEvents] = useState<DisasterEvent[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let cancelled = false
    getEventRegister().then(data => {
      if (!cancelled) setEvents(data.events.filter(event => event.status === 'active'))
    }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Cannot load disaster events.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])
  // A Leaflet control keeps availability visible without treating a marker as a hazard footprint.
  useEffect(() => {
    const container = map.getContainer()
    const status = document.createElement('div')
    status.setAttribute('role', 'status')
    status.style.cssText = 'position:absolute;bottom:30px;left:12px;z-index:500;max-width:75%;padding:8px 12px;background:white;color:#183153;border-radius:6px;font-size:12px;pointer-events:none;'
    const located = events.filter(e => e.latitude !== null && e.longitude !== null).length
    status.textContent = loading ? 'Loading declared disaster events…' : error || `Declared events: ${located} mapped, ${events.length - located} without coordinates. Reference points only.`
    container.appendChild(status)
    return () => status.remove()
  }, [map, events, error, loading])
  return <>{events.filter(e => e.latitude !== null && e.longitude !== null).map(event => <CircleMarker key={event.event_id} center={[Number(event.latitude), Number(event.longitude)]} radius={11} pathOptions={{ color: colors[event.hazard_type], fillOpacity: 0.8 }}>
    <Popup><strong>{event.name}</strong><br />{hazardLabels[event.hazard_type]} · Active declaration<br />{event.location_description}<br />Reference point; not a danger-zone boundary.</Popup>
  </CircleMarker>)}</>
}
