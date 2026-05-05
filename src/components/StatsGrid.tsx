import type { StatCardData } from '../types/dashboard'
import { StatCard } from './StatCard'

type StatsGridProps = {
  stats: StatCardData[]
}

export function StatsGrid({ stats }: StatsGridProps) {
  // Loops through all stat objects and creates one StatCard for each.
  return (
    <section className="stats-grid">
      {stats.map((stat) => (
        <StatCard key={stat.label} stat={stat} />
      ))}
    </section>
  )
}
