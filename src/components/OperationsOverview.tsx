import type { Alert, EvacuationCenter, Resident } from '../types/dashboard'

type OperationsOverviewProps = {
  residents: Resident[]
  alerts: Alert[]
  centers: EvacuationCenter[]
}

export function OperationsOverview({ residents, alerts, centers }: OperationsOverviewProps) {
  const atRiskResidents = residents.filter((resident) => resident.floodZone)
  const criticalAlerts = alerts.filter((alert) => alert.priority === 'high').length
  const totalCapacity = centers.reduce((sum, center) => sum + center.capacity, 0)
  const occupiedCapacity = centers.reduce((sum, center) => sum + center.occupied, 0)
  const availableSlots = Math.max(0, totalCapacity - occupiedCapacity)
  const fullCenters = centers.filter((center) => center.capacity > 0 && center.occupied >= center.capacity).length

  const priorityResidents = [...atRiskResidents]
    .sort((a, b) => vulnerabilityScore(b) - vulnerabilityScore(a))
    .slice(0, 3)

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
        <Metric label="Priority residents" value={atRiskResidents.length} detail="Flood-risk profiles" tone="danger" />
        <Metric label="Critical alerts" value={criticalAlerts} detail="Requires responder review" tone="warning" />
        <Metric label="Available shelter slots" value={availableSlots} detail={`${fullCenters} center(s) at capacity`} tone="success" />
        <Metric label="Registered centers" value={centers.length} detail="Ready for assignment" tone="info" />
      </div>

      <div className="operations-grid">
        <section className="panel priority-queue">
          <div className="section-header">
            <div>
              <span className="panel-kicker">VULNERABILITY PRIORITY INDEX</span>
              <h3>Residents needing attention</h3>
            </div>
            <span>{atRiskResidents.length} flagged</span>
          </div>

          {priorityResidents.length === 0 ? (
            <p className="empty-state">No flood-risk residents are currently flagged.</p>
          ) : (
            <div className="priority-list">
              {priorityResidents.map((resident) => (
                <article className="priority-row" key={resident.id}>
                  <span className="priority-marker">{vulnerabilityScore(resident)}</span>
                  <div>
                    <strong>{resident.name}</strong>
                    <span>{resident.sitio} · {resident.constraint}</span>
                  </div>
                  <span className={`status ${resident.status.toLowerCase()}`}>{resident.status}</span>
                </article>
              ))}
            </div>
          )}
        </section>

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
          <p className="readiness-note">
            When a center reaches capacity, responders should assign the next available center and
            record the transfer for all teams to see.
          </p>
        </section>
      </div>
    </section>
  )
}

function vulnerabilityScore(resident: Resident) {
  const constraintPoints: Record<Resident['constraint'], number> = {
    Bedridden: 4,
    Wheelchair: 3,
    Visual: 2,
    'Walk Assist': 1,
  }

  return 5 + constraintPoints[resident.constraint] + (resident.status === 'Pending' ? 2 : 0)
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
