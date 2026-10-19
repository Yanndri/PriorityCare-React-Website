import { Icon } from './Icon'

type PageTitleProps = {
  title: string
  /** Position of the tab in the sidebar, shown as "§ 03". */
  index?: number
  onExportReport: () => void
}

export function PageTitle({ title, index = 0, onExportReport }: PageTitleProps) {
  // The export button calls the function passed from App.tsx.
  return (
    <section className="page-title">
      <div>
        <div className="meta">§ {String(Math.max(index, 0)).padStart(2, '0')} — {title}</div>
        <h2>{title}</h2>
        <p>Monitor residents, risks, alerts, and evacuation readiness from one workspace.</p>
      </div>

      <button type="button" className="primary-button" onClick={onExportReport}>
        <Icon name="download" />
        Export Report
      </button>
    </section>
  )
}
