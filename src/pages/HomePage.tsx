import type { EvacuationCenter, MenuKey, Resident, StatCardData } from '../types/dashboard'
import { StatsGrid } from '../components/StatsGrid'
import { TodayTasks } from '../components/TodayTasks'

type HomePageProps = {
  stats: StatCardData[]
  evacuationCenters: EvacuationCenter[]
  scopeBarangayId: number | null
  allResidents: Resident[]
  onOpen: (menu: MenuKey) => void
}

// Today page: what needs doing, then the headline numbers. Everything else
// lives on its own page so this one stays short.
export function HomePage({ stats, evacuationCenters, scopeBarangayId, allResidents, onOpen }: HomePageProps) {
  return (
    <>
      <TodayTasks
        scopeBarangayId={scopeBarangayId}
        residents={allResidents}
        centers={evacuationCenters}
        onOpen={onOpen}
      />
      <StatsGrid stats={stats} />
    </>
  )
}
