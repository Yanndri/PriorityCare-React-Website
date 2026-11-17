import type { ConstraintStat } from '../types/dashboard'

type ConstraintChartProps = {
  stats: ConstraintStat[]
  title?: string
}

export function ConstraintChart({ stats, title = 'Residents by Constraint Type' }: ConstraintChartProps) {
  // Creates simple horizontal bars using percentages from App.tsx.
  return (
    <section className="panel">
      <h3>{title}</h3>

      <div className="bar-list">
        {stats.map((item) => (
          <div className="bar-row" key={item.label}>
            <span>{item.label}</span>

            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${item.percent}%` }} />
            </div>

            <strong>{item.value}</strong>
          </div>
        ))}
      </div>
    </section>
  )
}
