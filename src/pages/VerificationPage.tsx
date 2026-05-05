import type { Resident, Status } from '../types/dashboard'
import { ResidentTable } from '../components/ResidentTable'

type VerificationPageProps = {
  residents: Resident[]
  searchTerm: string
  statusFilter: 'All' | Status
  onSearchChange: (value: string) => void
  onStatusFilterChange: (value: 'All' | Status) => void
}

export function VerificationPage({
  residents,
  searchTerm,
  statusFilter,
  onSearchChange,
  onStatusFilterChange,
}: VerificationPageProps) {
  // Shows the full resident table instead of only the first few rows.
  return (
    <ResidentTable
      title="Verification Queue"
      residents={residents}
      searchTerm={searchTerm}
      statusFilter={statusFilter}
      onSearchChange={onSearchChange}
      onStatusFilterChange={onStatusFilterChange}
    />
  )
}
