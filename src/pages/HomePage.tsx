import type { EvacuationCenter, MenuKey, Resident } from '../types/dashboard'
import type { OperationStatus } from '../lib/useOperationStatus'
import { TodayTasks } from '../components/TodayTasks'

type HomePageProps = {
  evacuationCenters: EvacuationCenter[]
  scopeBarangayId: number | null
  scopeLabel: string
  isSuperAdmin: boolean
  allResidents: Resident[]
  onOpen: (menu: MenuKey) => void
  operation: OperationStatus
}

// Today page: how things stand, four numbers, then what needs doing.
// Everything else lives on its own page so this one stays short.
export function HomePage({ evacuationCenters, scopeBarangayId, scopeLabel, isSuperAdmin, allResidents, onOpen, operation }: HomePageProps) {
  return (
    <TodayTasks
      scopeBarangayId={scopeBarangayId}
      scopeLabel={scopeLabel}
      isSuperAdmin={isSuperAdmin}
      residents={allResidents}
      centers={evacuationCenters}
      onOpen={onOpen}
      waitingAlarms={operation.waitingAlarms}
      activeEvents={operation.active}
    />
  )
}
