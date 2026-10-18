import { useMemo } from 'react'
import L from 'leaflet'
import { CircleMarker, MapContainer, Marker, TileLayer, Tooltip, useMapEvents } from 'react-leaflet'
import type { EvacuationCenter } from '../types/dashboard'

// Map picker for registering an evacuation facility: drag the pin (or click
// the map) to set the GPS coordinates. Existing facilities are shown for
// reference so a new one is not placed on top of another. The typed
// latitude/longitude fields stay the source of truth.

const DEFAULT_VIEW: [number, number] = [10.3157, 123.8854] // Cebu City

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
  disabled?: boolean
  onChange: (latitude: string, longitude: string) => void
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

export function FacilityLocationPicker({ latitude, longitude, centers, disabled, onChange }: Props) {
  const point = toPoint(latitude, longitude)
  const place = (lat: number, lng: number) => onChange(format(lat), format(lng))

  const existing = useMemo(
    () => centers.filter((center) =>
      Number.isFinite(center.gpsLat) && Number.isFinite(center.gpsLong)
      && !(center.gpsLat === 0 && center.gpsLong === 0)),
    [centers],
  )

  const markerHandlers = useMemo(() => ({
    dragend(event: L.LeafletEvent) {
      const position = (event.target as L.Marker).getLatLng()
      onChange(format(position.lat), format(position.lng))
    },
  }), [onChange])

  return (
    <div className="facility-picker">
      <p className="facility-picker-hint">
        {point
          ? 'Drag the pin to adjust the location, or click the map to move it.'
          : 'Click the map, or drag the pin, to set the facility location.'}
      </p>
      <div className="facility-picker-map">
        <MapContainer center={point ?? DEFAULT_VIEW} zoom={15} scrollWheelZoom style={{ width: '100%', height: '100%' }}>
          <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
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
            position={point ?? DEFAULT_VIEW}
            icon={pinIcon}
            draggable={!disabled}
            eventHandlers={markerHandlers}
            opacity={point ? 1 : 0.6}
          >
            <Tooltip>New facility location</Tooltip>
          </Marker>
        </MapContainer>
      </div>
      <p className="facility-picker-legend">
        <span><i className="legend-new" /> New facility</span>
        <span><i className="legend-existing" /> Existing facilities</span>
      </p>
    </div>
  )
}
