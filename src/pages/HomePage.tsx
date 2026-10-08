import type { Alert, ConstraintStat, Resident, StatCardData, Status } from '../types/dashboard'
import { AlertsPanel } from '../components/AlertsPanel'
import { ConstraintChart } from '../components/ConstraintChart'
import { ResidentTable } from '../components/ResidentTable'
import { StatsGrid } from '../components/StatsGrid'
import { OperationsOverview } from '../components/OperationsOverview'
import type { EvacuationCenter } from '../types/dashboard'

type HomePageProps = {
  stats: StatCardData[]
  residents: Resident[]
  alerts: Alert[]
  evacuationCenters: EvacuationCenter[]
  constraintStats: ConstraintStat[]
  searchTerm: string
  statusFilter: 'All' | Status
  onSearchChange: (value: string) => void
  onStatusFilterChange: (value: 'All' | Status) => void
}

export function HomePage({
  stats,
  residents,
  alerts,
  evacuationCenters,
  constraintStats,
  searchTerm,
  statusFilter,
  onSearchChange,
  onStatusFilterChange,
}: HomePageProps) {
  // Home page combines the main dashboard widgets.
  return (
    <>
      <StatsGrid stats={stats} />

      <OperationsOverview
        residents={residents}
        alerts={alerts}
        centers={evacuationCenters}
      />

      <section className="dashboard-grid">
        <ResidentTable
          title="Recent Registrations"
          residents={residents.slice(0, 4)}
          searchTerm={searchTerm}
          statusFilter={statusFilter}
          onSearchChange={onSearchChange}
          onStatusFilterChange={onStatusFilterChange}
        />

        <aside className="right-column">
          <AlertsPanel alerts={alerts} />
          <ConstraintChart stats={constraintStats} />
        </aside>
      </section>
    </>
  )
}
