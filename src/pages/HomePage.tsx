import type { Alert, ConstraintStat, Resident, StatCardData, Status } from '../types/dashboard'
import { AlertsPanel } from '../components/AlertsPanel'
import { ConstraintChart } from '../components/ConstraintChart'
import { ResidentTable } from '../components/ResidentTable'
import { StatsGrid } from '../components/StatsGrid'
import { OperationsOverview } from '../components/OperationsOverview'
import type { EvacuationCenter, MenuKey } from '../types/dashboard'
import { TodayTasks } from '../components/TodayTasks'

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
  locationOptions?: string[]
  scopeBarangayId: number | null
  allResidents: Resident[]
  onOpen: (menu: MenuKey) => void
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
  locationOptions,
  scopeBarangayId,
  allResidents,
  onOpen,
}: HomePageProps) {
  // Home page combines the main dashboard widgets.
  return (
    <>
      <TodayTasks
        scopeBarangayId={scopeBarangayId}
        residents={allResidents}
        centers={evacuationCenters}
        onOpen={onOpen}
      />

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
          locationOptions={locationOptions}
        />

        <aside className="right-column">
          <AlertsPanel alerts={alerts} />
          <ConstraintChart stats={constraintStats} />
        </aside>
      </section>
    </>
  )
}
