// Small presentational pieces shared by the Disaster Analytics panels.
// They reuse the existing mining-* styles from App.css.

export function AnalyticsCard({ label, value, note }: { label: string; value: number | string; note: string }) {
  return (
    <article className="mining-card">
      <strong>{value}</strong>
      <span>{label}</span>
      <small>{note}</small>
    </article>
  )
}

export function AnalyticsBars({ rows, empty }: { rows: { label: string; value: number }[]; empty: string }) {
  const max = Math.max(1, ...rows.map((row) => row.value))
  if (!rows.some((row) => row.value > 0)) return <p className="mining-description">{empty}</p>
  return (
    <div className="mining-bar-list">
      {rows.map((row) => (
        <div className="mining-bar-row" key={row.label}>
          <div>
            <span>{row.label}</span>
            <strong>{row.value}</strong>
          </div>
          <div className="mining-track" aria-hidden="true">
            <div className="mining-fill" style={{ width: `${Math.round((row.value / max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}
