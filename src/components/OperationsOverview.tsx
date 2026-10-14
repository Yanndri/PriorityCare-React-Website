import type { Alert, EvacuationCenter, Resident } from '../types/dashboard'
import { VpiPanel } from './VpiPanel'

type OperationsOverviewProps = {
  residents: Resident[]
  alerts: Alert[]
  centers: EvacuationCenter[]
}

export function OperationsOverview({ residents, alerts, centers }: OperationsOverviewProps) {
  const criticalAlerts = alerts.filter((alert) => alert.priority === 'high').length
  const activeCenters = centers.filter((center) => center.status.toLowerCase() !== 'closed')
  const knownCenters = activeCenters.filter((center) => center.capacityConfirmed && center.occupancyKnown)
  const unknownCenters = activeCenters.length - knownCenters.length
  const totalCapacity = knownCenters.reduce((sum, center) => sum + center.capacity, 0)
  const occupiedCapacity = knownCenters.reduce((sum, center) => sum + center.occupied, 0)
  const availableSlots = knownCenters.reduce((sum, center) => sum + Math.max(0, center.capacity - center.occupied), 0)
  const fullCenters = knownCenters.filter((center) => center.occupied >= center.capacity).length

  return (
    <section className="operations-overview">
      <div className="operations-banner">
        <div>
          <span className="operations-kicker">FIELD OPERATIONS</span>
          <h3>Keep response teams ahead of the next emergency.</h3>
          <p>
            Use this control room to review vulnerable residents, track shelter capacity, and
            route incoming distress reports.
          </p>
        </div>
        <span className="operations-state"><span className="live-dot" /> Monitoring active</span>
      </div>

      <div className="operations-metrics">
        <Metric label="Resident profiles" value={residents.length} detail="Available for assessment" tone="info" />
        <Metric label="Critical alerts" value={criticalAlerts} detail="Requires responder review" tone="warning" />
        <Metric label="Known shelter slots" value={availableSlots} detail={`${fullCenters} full · ${unknownCenters} awaiting capacity/count`} tone="success" />
        <Metric label="Active centers" value={activeCenters.length} detail={`${centers.length - activeCenters.length} closed`} tone="info" />
      </div>

      <div className="operations-grid">
        <VpiPanel residents={residents} />

        <section className="panel shelter-readiness">
          <div className="section-header">
            <div>
              <span className="panel-kicker">SHELTER READINESS</span>
              <h3>Evacuation capacity</h3>
            </div>
            <span>{totalCapacity === 0 ? 0 : Math.round((occupiedCapacity / totalCapacity) * 100)}% occupied</span>
          </div>
          <div className="readiness-track">
            <span style={{ width: `${totalCapacity === 0 ? 0 : Math.min(100, (occupiedCapacity / totalCapacity) * 100)}%` }} />
          </div>
          <div className="readiness-values">
            <strong>{occupiedCapacity} occupied</strong>
            <span>{totalCapacity} total capacity</span>
          </div>
          {unknownCenters > 0 && <p>{unknownCenters} center(s) excluded until their capacity and facility-wide count are available.</p>}
          <p className="readiness-note">
            When a center reaches capacity, responders should assign the next available center and
            record the transfer for all teams to see.
          </p>
        </section>
      </div>
    </section>
  )
}

type MetricProps = {
  label: string
  value: number
  detail: string
  tone: 'danger' | 'warning' | 'success' | 'info'
}

function Metric({ label, value, detail, tone }: MetricProps) {
  return (
    <article className={`operations-metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  )
}
