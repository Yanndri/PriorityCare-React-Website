import type { Resident } from '../types/dashboard'

import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
} from 'react-leaflet'

import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'

type GeoMapPageProps = {
  residents: Resident[]
}

// Cebu default coordinates
const CEBU_COORDINATES: [number, number] = [10.3157, 123.8854]

// Fix Leaflet marker issue in Vite
delete (L.Icon.Default.prototype as any)._getIconUrl

L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',

  iconUrl:
    'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',

  shadowUrl:
    'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

// Red marker for flood-prone residents
const highRiskIcon = new L.Icon({
  iconUrl:
    'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',

  shadowUrl:
    'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',

  iconSize: [25, 41],
  iconAnchor: [12, 41],
})

// Green marker for evacuation centers
const evacuationIcon = new L.Icon({
  iconUrl:
    'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png',

  shadowUrl:
    'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',

  iconSize: [25, 41],
  iconAnchor: [12, 41],
})

// Sample evacuation centers
const evacuationCenters = [
  {
    id: 1,
    name: 'Barangay Hall',
    position: [10.3185, 123.8851] as [number, number],
  },

  {
    id: 2,
    name: 'Community Gym',
    position: [10.3115, 123.8912] as [number, number],
  },

  {
    id: 3,
    name: 'Elementary School',
    position: [10.3202, 123.8795] as [number, number],
  },
]

export function GeoMapPage({
  residents,
}: GeoMapPageProps) {

  // Only flood-prone residents
  const residentsInFloodZones = residents.filter(
    (resident) => resident.floodZone
  )

  return (
    <section className="panel map-panel">
      <h3>Geo Map</h3>

      <MapContainer
        center={CEBU_COORDINATES}
        zoom={13}
        scrollWheelZoom={true}
        style={{
          height: '500px',
          width: '100%',
          borderRadius: '18px',
        }}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {/* Flood-prone residents */}
        {residentsInFloodZones.map((resident, index) => {

          // Temporary generated positions
          const markerPosition: [number, number] = [
            CEBU_COORDINATES[0] + index * 0.01,
            CEBU_COORDINATES[1] + index * 0.01,
          ]

          return (
            <Marker
              key={resident.id}
              position={markerPosition}
              icon={highRiskIcon}
            >
              <Popup>
                <strong>{resident.name}</strong>

                <br />

                {resident.sitio}

                <br />

                Flood-prone area
              </Popup>
            </Marker>
          )
        })}

        {/* Evacuation Centers */}
        {evacuationCenters.map((center) => (
          <Marker
            key={center.id}
            position={center.position}
            icon={evacuationIcon}
          >
            <Popup>
              <strong>{center.name}</strong>

              <br />

              Evacuation Center
            </Popup>
          </Marker>
        ))}
      </MapContainer>

      <p className="panel-note">
        🔴 Red markers = Flood-prone residents

        <br />

        🟢 Green markers = Evacuation centers
      </p>
    </section>
  )
}