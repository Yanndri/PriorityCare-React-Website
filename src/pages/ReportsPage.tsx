import { RdanaSummaryPanel } from '../components/RdanaSummaryPanel'
import { DromicExportPanel } from '../components/DromicExportPanel'
import { AuditTrailPanel } from '../components/AuditTrailPanel'
import { SubTabs } from '../components/SubTabs'

// The three official reports, one tab each.
export function ReportsPage() {
  return (
    <SubTabs
      label="Reports"
      parts={[
        { key: 'dromic', label: 'DROMIC (relief)', content: <DromicExportPanel /> },
        { key: 'rdana', label: 'RDANA (situation)', content: <RdanaSummaryPanel /> },
        { key: 'audit', label: 'Evacuation audit trail', content: <AuditTrailPanel /> },
      ]}
    />
  )
}
