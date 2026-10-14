import type { StatCardData } from '../types/dashboard'
import { RdanaSummaryPanel } from '../components/RdanaSummaryPanel'
import { DromicExportPanel } from '../components/DromicExportPanel'
import { AuditTrailPanel } from '../components/AuditTrailPanel'

type ReportsPageProps = {
  stats: StatCardData[]
}

export function ReportsPage({ stats }: ReportsPageProps) {
  // Uses the same stat data as the dashboard, but in a report-card layout.
  return (
    <>
    <DromicExportPanel />
    <RdanaSummaryPanel />
    <AuditTrailPanel />
    <section className="panel reports-grid">
      {stats.map((stat) => (
        <article className="report-card" key={stat.label}>
          <span>{stat.label}</span>
          <strong>{stat.value}</strong>
          <small>{stat.note}</small>
        </article>
      ))}
    </section>
    </>
  )
}
