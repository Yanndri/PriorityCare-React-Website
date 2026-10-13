type PageTitleProps = {
  title: string
  onExportReport: () => void
}

export function PageTitle({ title, onExportReport }: PageTitleProps) {
  // The export button calls the function passed from App.tsx.
  return (
    <section className="page-title">
      <div>
        <h2>{title}</h2>
        <p>Monitor residents, risks, alerts, and evacuation readiness from one workspace.</p>
      </div>

      <button className="primary-button" onClick={onExportReport}>
        Export Report
      </button>
    </section>
  )
}
