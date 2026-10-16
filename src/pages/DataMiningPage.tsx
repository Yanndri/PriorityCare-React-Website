import { useState } from 'react'
import type { Resident } from '../types/dashboard'
import { RdanaSummaryPanel } from '../components/RdanaSummaryPanel'
import { DromicExportPanel } from '../components/DromicExportPanel'
import { RescueReconciliationPanel } from '../components/analytics/RescueReconciliationPanel'
import { VulnerabilityHeatmapPanel } from '../components/analytics/VulnerabilityHeatmapPanel'
import { AuditTrailPanel } from '../components/analytics/AuditTrailPanel'

// Appendix N, Module 3: Statutory Disaster Analytics & Report Generation.
// Every view reads live, role-scoped records: the database functions and the
// existing report builders limit data to the signed-in administrator's sitio.

const tabs = [
  { key: 'reconciliation', label: 'Rescued vs. Missing', title: 'Reconcile Master Rescued Directory vs. Missing Persons Manifest' },
  { key: 'rdana', label: 'RDANA Summaries', title: 'Automated 24–48 Hour RDANA Situation Summaries' },
  { key: 'dromic', label: 'DROMIC Reports', title: 'DSWD-DROMIC-style Relief & Population Reports (PDF / Excel)' },
  { key: 'heatmaps', label: 'Heatmaps', title: 'Spatial Demographic Vulnerability & Incident Heatmaps' },
  { key: 'audit', label: 'Audit Trails', title: 'Evacuation Audit Trails & Operational Timestamp Logs' },
] as const
type TabKey = (typeof tabs)[number]['key']

type DataMiningPageProps = {
  residents: Resident[]
}

export function DataMiningPage({ residents }: DataMiningPageProps) {
  const [active, setActive] = useState<TabKey>('reconciliation')
  // Panels stay mounted after their first visit so drafts and loaded logs survive tab switches.
  const [visited, setVisited] = useState<TabKey[]>(['reconciliation'])

  function open(key: TabKey) {
    setActive(key)
    setVisited((current) => (current.includes(key) ? current : [...current, key]))
  }

  const current = tabs.find((tab) => tab.key === active)!

  return (
    <section className="data-mining-page">
      <div className="panel mining-intro">
        <div>
          <span className="panel-kicker">APPENDIX N · MODULE 3</span>
          <h3>Statutory Disaster Analytics & Report Generation</h3>
          <p>{current.title}</p>
        </div>
      </div>

      <div className="analytics-tabs" role="tablist" aria-label="Disaster analytics functions">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            id={`analytics-tab-${tab.key}`}
            aria-selected={active === tab.key}
            aria-controls={`analytics-panel-${tab.key}`}
            className={`analytics-tab ${active === tab.key ? 'active' : ''}`}
            onClick={() => open(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {tabs.map((tab) => visited.includes(tab.key) && (
        <div
          key={tab.key}
          role="tabpanel"
          id={`analytics-panel-${tab.key}`}
          aria-labelledby={`analytics-tab-${tab.key}`}
          hidden={active !== tab.key}
        >
          {tab.key === 'reconciliation' && <RescueReconciliationPanel />}
          {tab.key === 'rdana' && <RdanaSummaryPanel />}
          {tab.key === 'dromic' && <DromicExportPanel />}
          {tab.key === 'heatmaps' && <VulnerabilityHeatmapPanel residents={residents} active={active === 'heatmaps'} />}
          {tab.key === 'audit' && <AuditTrailPanel />}
        </div>
      ))}
    </section>
  )
}
