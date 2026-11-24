import { useMemo, useState } from 'react'
import L from 'leaflet'
import { CircleMarker, MapContainer, Marker, TileLayer, Tooltip, useMapEvents } from 'react-leaflet'
import type { EvacuationCenter } from '../types/dashboard'
import { useBarangayView, CORDOVA_MAP_LIMITS } from '../lib/barangayCenters'
import { MapFocus } from './MapFocus'
import { isInCordova, OUTSIDE_CORDOVA, useBarangayBorders } from '../utils/barangayBorders'

// Map picker for registering an evacuation facility: drag the pin (or click
// the map) to set the GPS coordinates. Existing facilities are shown for
// reference so a new one is not placed on top of another. The typed
// latitude/longitude fields stay the source of truth.

const pinIcon = L.divIcon({
  className: 'facility-pin',
  html: '<span aria-hidden="true"></span>',
  iconSize: [26, 26],
  iconAnchor: [13, 26],
})

type Props = {
  latitude: string
  longitude: string
  centers: EvacuationCenter[]
  // Barangay to open the map on; null = all of Cordova.
  focusBarangayId?: number | null
  disabled?: boolean
  onChange: (latitude: string, longitude: string) => void
  // Label for the pin being placed ("New facility" when registering, the center's name when editing).
  pinLabel?: string
  // The center being edited, left out of the "existing" dots.
  excludeId?: number | string
  // What the pin marks, used in the hint ("facility", "house").
  subject?: string
}

function toPoint(latitude: string, longitude: string): [number, number] | null {
  if (latitude.trim() === '' || longitude.trim() === '') return null
  const lat = Number(latitude)
  const lng = Number(longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return [lat, lng]
}

const format = (value: number) => value.toFixed(6)

function ClickToPlace({ disabled, onPlace }: { disabled?: boolean; onPlace: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(event) {
      if (!disabled) onPlace(event.latlng.lat, event.latlng.lng)
    },
  })
  return null
}

export function FacilityLocationPicker({ latitude, longitude, centers, focusBarangayId = null, disabled, onChange, pinLabel = 'New facility', excludeId, subject = 'facility' }: Props) {
  const view = useBarangayView(focusBarangayId)
  const point = toPoint(latitude, longitude)
  const borders = useBarangayBorders()
  const [outside, setOutside] = useState(false)
  // Only spots inside Cordova are accepted.
  const place = (lat: number, lng: number) => {
    const ok = isInCordova(lat, lng, borders)
    setOutside(!ok)
    if (ok) onChange(format(lat), format(lng))
  }

  const existing = useMemo(
    () => centers.filter((center) =>
      center.id !== excludeId && Number.isFinite(center.gpsLat) && Number.isFinite(center.gpsLong)
      && !(center.gpsLat === 0 && center.gpsLong === 0)),
    [centers, excludeId],
  )

  const markerHandlers = useMemo(() => ({
    dragend(event: L.LeafletEvent) {
      const marker = event.target as L.Marker
      const position = marker.getLatLng()
      const ok = isInCordova(position.lat, position.lng, borders)
      setOutside(!ok)
      if (ok) onChange(format(position.lat), format(position.lng))
      else if (point) marker.setLatLng(point)
    },
  }), [onChange, borders, point])

  return (
    <div className="facility-picker">
      <p className="facility-picker-hint">
        {point
          ? 'Drag the pin to adjust the location, or click the map to move it.'
          : `Click the map, or drag the pin, to set the ${subject} location.`}
      </p>
      {outside && <p className="facility-picker-hint" role="alert">{OUTSIDE_CORDOVA}</p>}
      <div className="facility-picker-map">
        <MapContainer {...CORDOVA_MAP_LIMITS} center={point ?? view.center} zoom={view.zoom} scrollWheelZoom style={{ width: '100%', height: '100%' }}>
          <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <MapFocus center={view.center} zoom={view.zoom} />
          <ClickToPlace disabled={disabled} onPlace={place} />
          {existing.map((center) => (
            <CircleMarker
              key={String(center.id ?? center.name)}
              center={[center.gpsLat as number, center.gpsLong as number]}
              radius={7}
              pathOptions={{ color: '#ffffff', weight: 2, fillColor: center.status.toLowerCase() === 'closed' ? '#94a3b8' : '#0abd67', fillOpacity: 0.95 }}
            >
              <Tooltip>{center.name} (existing{center.status.toLowerCase() === 'closed' ? ', closed' : ''})</Tooltip>
            </CircleMarker>
          ))}
          <Marker
            position={point ?? view.center}
            icon={pinIcon}
            draggable={!disabled}
            eventHandlers={markerHandlers}
            opacity={point ? 1 : 0.6}
          >
            <Tooltip>{pinLabel} location</Tooltip>
          </Marker>
        </MapContainer>
      </div>
      {existing.length > 0 && <p className="facility-picker-legend">
        <span><i className="legend-new" /> {pinLabel}</span>
        <span><i className="legend-existing" /> Existing facilities</span>
      </p>}
    </div>
  )
}
