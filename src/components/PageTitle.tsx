import { Icon } from './Icon'

type PageTitleProps = {
  title: string
  /** One plain sentence saying what the page is for. */
  description: string
  /** Shown only where exporting makes sense (the Today page). */
  onExportReport?: () => void
}

export function PageTitle({ title, description, onExportReport }: PageTitleProps) {
  // The export button calls the function passed from App.tsx.
  return (
    <section className="page-title">
      <div>
        <h2>
          {title}
          <span className="page-help" tabIndex={0} role="note" aria-label={description} data-tip={description}>?</span>
        </h2>
      </div>

      {onExportReport && (
        <button type="button" className="primary-button" onClick={onExportReport}>
          <Icon name="download" />
          Export Report
        </button>
      )}
    </section>
  )
}
