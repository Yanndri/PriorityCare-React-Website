import type { StatCardData } from '../types/dashboard'

type StatCardProps = {
  stat: StatCardData
}

export function StatCard({ stat }: StatCardProps) {
  // One reusable card used inside StatsGrid.
  return (
    <article className="stat-card">
      <strong className={stat.tone}>{stat.value}</strong>
      <span>{stat.label}</span>
      <small className={stat.tone}>{stat.note}</small>
    </article>
  )
}
