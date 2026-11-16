import { RdanaSummaryPanel } from '../components/RdanaSummaryPanel'
import { DromicExportPanel } from '../components/DromicExportPanel'
import { AuditTrailPanel } from '../components/AuditTrailPanel'
import { SubTabs } from '../components/SubTabs'

// The three official reports, one tab each.
// canAttachRelief: relief planning (Appendix N 2.3) is Municipal/System Admin only.
export function ReportsPage({ canAttachRelief = false }: { canAttachRelief?: boolean }) {
  return (
    <SubTabs
      label="Reports"
      parts={[
        { key: 'dromic', label: 'DROMIC (relief)', content: <DromicExportPanel canAttachRelief={canAttachRelief} /> },
        { key: 'rdana', label: 'RDANA (situation)', content: <RdanaSummaryPanel /> },
        { key: 'audit', label: 'Evacuation audit trail', content: <AuditTrailPanel /> },
      ]}
    />
  )
}
