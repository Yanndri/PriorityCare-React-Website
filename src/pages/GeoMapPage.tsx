import type { Resident } from '../types/dashboard'

type GeoMapPageProps = {
  residents: Resident[]
}

export function GeoMapPage({ residents }: GeoMapPageProps) {
  // Only residents marked as floodZone are shown as map pins.
  const residentsInFloodZones = residents.filter((resident) => resident.floodZone)

  return (
    <section className="panel map-panel">
      <h3>Geo Map</h3>

      <div className="map-placeholder">
        {residentsInFloodZones.map((resident, index) => (
          <span
            key={resident.id}
            className="map-pin"
            style={{
              left: `${18 + index * 14}%`,
              top: `${28 + (index % 3) * 18}%`,
            }}
            title={resident.name}
          />
        ))}
      </div>

      <p className="panel-note">Pins represent residents marked as living in flood-prone zones.</p>
    </section>
  )
}
