import type { Alert } from '../types/dashboard'

type AlertsPanelProps = {
  alerts: Alert[]
}

export function AlertsPanel({ alerts }: AlertsPanelProps) {
  // Displays alert cards with different colors based on priority.
  return (
    <section className="panel">
      <div className="section-header">
        <h3>Alerts</h3>
        <span className="new-pill">{alerts.length} new</span>
      </div>

      <div className="alert-list">
        {alerts.map((alert) => (
          <article className={`alert-card ${alert.priority}`} key={alert.id}>
            <strong>{alert.title}</strong>
            <span>{alert.time}</span>
          </article>
        ))}
      </div>
    </section>
  )
}
