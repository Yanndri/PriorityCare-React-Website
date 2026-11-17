import { useEffect } from 'react'
import L from 'leaflet'
import { CircleMarker, MapContainer, Marker, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import { CORDOVA_CENTER, CORDOVA_MAP_LIMITS, MUNICIPAL_ZOOM, inCordovaBox } from '../lib/barangayCenters'

// Where the unit should go, on a map.
// - From an SOS with a location: the SOS pin is fixed and the map does not move. It frames the
//   SOS pin together with the resident's registered home, for comparison.
// - Manual ticket (or an SOS sent without a location): the admin moves the map and clicks
//   where the unit should go. The pin can be dragged to fine-tune it.

const pin = L.divIcon({
  className: 'ticket-pin',
  html: '<span aria-hidden="true"></span>',
  iconSize: [26, 26],
  iconAnchor: [13, 26],
})

type Props = {
  latitude: string
  longitude: string
  home?: { lat: number; lng: number } | null
  /** true = ticket from an SOS: if it came with a location, the pin and the map are fixed. */
  fixed?: boolean
  onChange: (latitude: string, longitude: string) => void
}

const toNum = (v: string) => (v.trim() === '' ? NaN : Number(v))

function ClickToPlace({ onPlace }: { onPlace: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPlace(e.latlng.lat, e.latlng.lng) })
  return null
}

// When the spot changes from outside the map (e.g. a resident was picked), bring it into view.
function KeepInView({ point }: { point: [number, number] | null }) {
  const map = useMap()
  const lat = point?.[0]
  const lng = point?.[1]
  useEffect(() => {
    if (lat != null && lng != null && !map.getBounds().contains([lat, lng])) map.setView([lat, lng], Math.max(map.getZoom(), 16))
  }, [map, lat, lng])
  return null
}

export function TicketLocationMap({ latitude, longitude, home, fixed = false, onChange }: Props) {
  const lat = toNum(latitude)
  const lng = toNum(longitude)
  const point: [number, number] | null = Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null
  const locked = fixed && point !== null
  const away = point && home ? L.latLng(point).distanceTo(L.latLng(home.lat, home.lng)) : null
  const place = (a: number, b: number) => { if (inCordovaBox(a, b)) onChange(a.toFixed(6), b.toFixed(6)) }

  // Starting view: close on the SOS (street level). The home is framed in too only when it is
  // nearby (under 1 km); farther away, the legend gives the distance instead.
  const frame = locked && home && away != null && away > 50 && away < 1000 ? L.latLngBounds([point, [home.lat, home.lng]]) : null
  const view = frame
    ? { bounds: frame, boundsOptions: { padding: [40, 40] as [number, number], maxZoom: 17 } }
    : { center: point ?? (home ? [home.lat, home.lng] as [number, number] : CORDOVA_CENTER), zoom: point || home ? 16 : MUNICIPAL_ZOOM }
  const still = locked
    ? { dragging: false, scrollWheelZoom: false, doubleClickZoom: false, touchZoom: false, boxZoom: false, keyboard: false, zoomControl: false }
    : { scrollWheelZoom: true }

  return (
    <div className="ticket-map">
      <p className="facility-picker-hint">
        {locked ? 'Where the SOS was sent from. The unit goes here.'
          : point ? 'Where the unit should go. Click the map or drag the pin to change it.'
          : fixed ? 'No location was sent with this SOS. Click the map where the unit should go.'
          : 'Click the map where the unit should go.'}
      </p>
      <div className="ticket-map-frame">
        {/* Remount when a different SOS opens, so the fixed view frames the new one. */}
        {/* A fixed SOS view has no Cordova limits, so an SOS sent from just outside still shows. */}
        <MapContainer key={locked ? `${latitude},${longitude}` : 'pick'} {...(locked ? {} : CORDOVA_MAP_LIMITS)} {...view} {...still}
          style={{ width: '100%', height: '100%' }}>
          <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          {!locked && <ClickToPlace onPlace={place} />}
          {!locked && <KeepInView point={point} />}
          {home && (
            <CircleMarker center={[home.lat, home.lng]} radius={7}
              pathOptions={{ color: '#ffffff', weight: 2, fillColor: '#1d4ed8', fillOpacity: 0.95 }}>
              <Tooltip>Registered home</Tooltip>
            </CircleMarker>
          )}
          {point && (
            <Marker position={point} icon={pin} draggable={!locked}
              eventHandlers={locked ? {} : { dragend: (e) => { const p = (e.target as L.Marker).getLatLng(); place(p.lat, p.lng) } }}>
              <Tooltip permanent direction="top" offset={[0, -24]}>{fixed ? 'SOS location' : 'Go here'}</Tooltip>
            </Marker>
          )}
        </MapContainer>
      </div>
      <p className="facility-picker-legend">
        {point && <span><i className="legend-sos" /> {fixed ? 'SOS location' : 'Go here'}</span>}
        {home && <span><i className="legend-home" /> Registered home{away != null && away > 50 ? ` (${away >= 1000 ? `${(away / 1000).toFixed(1)} km` : `${Math.round(away)} m`} from the ${fixed ? 'SOS' : 'pin'})` : ''}</span>}
        {point && <span className="dispatch-muted">{point[0].toFixed(5)}, {point[1].toFixed(5)}</span>}
      </p>
    </div>
  )
}
