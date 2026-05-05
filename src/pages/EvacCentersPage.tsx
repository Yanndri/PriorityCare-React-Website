import type { EvacuationCenter } from '../types/dashboard'

type EvacCentersPageProps = {
  centers: EvacuationCenter[]
}

export function EvacCentersPage({ centers }: EvacCentersPageProps) {
  // Displays each evacuation center with a capacity progress bar.
  return (
    <section className="panel">
      <h3>Evacuation Centers</h3>

      <div className="center-list">
        {centers.map((center) => (
          <article className="center-card" key={center.name}>
            <div>
              <strong>{center.name}</strong>
              <span>{center.status}</span>
            </div>

            <div className="capacity-track">
              <div style={{ width: `${(center.occupied / center.capacity) * 100}%` }} />
            </div>

            <small>
              {center.occupied} / {center.capacity} occupied
            </small>
          </article>
        ))}
      </div>
    </section>
  )
}
