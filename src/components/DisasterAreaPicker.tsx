import { useMemo } from 'react'
import L from 'leaflet'
import { MapContainer, Marker, TileLayer, Tooltip, useMapEvents } from 'react-leaflet'
import { useBarangayView } from '../lib/barangayCenters'
import { MapFocus } from './MapFocus'

// Map pin for a declared disaster: click the map or drag the pin instead of
// typing coordinates.

const pinIcon = L.divIcon({
  className: 'facility-pin',
  html: '<span aria-hidden="true"></span>',
  iconSize: [26, 26],
  iconAnchor: [13, 26],
})

type Props = {
  barangayId: number | null
  latitude: number | null
  longitude: number | null
  disabled?: boolean
  onChange: (latitude: number | null, longitude: number | null) => void
}

const round = (value: number) => Math.round(value * 1e6) / 1e6

function ClickToPlace({ disabled, onPlace }: { disabled?: boolean; onPlace: (lat: number, lng: number) => void }) {
  useMapEvents({ click(event) { if (!disabled) onPlace(event.latlng.lat, event.latlng.lng) } })
  return null
}

export function DisasterAreaPicker({ barangayId, latitude, longitude, disabled, onChange }: Props) {
  const view = useBarangayView(barangayId)
  const point: [number, number] | null = latitude !== null && longitude !== null ? [latitude, longitude] : null
  const place = (lat: number, lng: number) => onChange(round(lat), round(lng))
  const handlers = useMemo(() => ({
    dragend(event: L.LeafletEvent) {
      const position = (event.target as L.Marker).getLatLng()
      onChange(round(position.lat), round(position.lng))
    },
  }), [onChange])

  return (
    <div className="facility-picker">
      <p className="facility-picker-hint">
        {point ? 'Drag the pin to adjust, or click the map to move it.' : 'Click the map where the disaster is happening.'}
      </p>
      <div className="facility-picker-map">
        <MapContainer center={point ?? view.center} zoom={view.zoom} scrollWheelZoom style={{ width: '100%', height: '100%' }}>
          <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <MapFocus center={view.center} zoom={view.zoom} />
          <ClickToPlace disabled={disabled} onPlace={place} />
          {point && (
            <Marker position={point} icon={pinIcon} draggable={!disabled} eventHandlers={handlers}>
              <Tooltip>Disaster location</Tooltip>
            </Marker>
          )}
        </MapContainer>
      </div>
      {point && (
        <p className="facility-picker-legend">
          <span>Pin: {point[0].toFixed(5)}, {point[1].toFixed(5)}</span>
          <button type="button" className="secondary-button" disabled={disabled} onClick={() => onChange(null, null)}>Remove pin</button>
        </p>
      )}
    </div>
  )
}
