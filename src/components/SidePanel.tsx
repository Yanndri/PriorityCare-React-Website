import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

// Add and Edit forms open in this panel on the right, over the page, so the list
// behind it stays where it was. Close it with ✕ or the form's Cancel button.
export function SidePanel({ title, onClose, error, busy = false, children }: {
  title: string
  onClose: () => void
  /** A save error, shown inside the panel so it is not hidden behind it. */
  error?: string
  busy?: boolean
  children: ReactNode
}) {
  const panel = useRef<HTMLElement | null>(null)
  // Put the cursor in the first field when the panel opens.
  useEffect(() => {
    panel.current?.querySelector<HTMLElement>('input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea')?.focus()
  }, [])
  return <div className="side-panel-backdrop">
    <aside ref={panel} className="side-panel" role="dialog" aria-modal="true" aria-label={title}>
      <header className="side-panel-head">
        <h3>{title}</h3>
        <button type="button" className="modal-close-button" aria-label="Close" disabled={busy} onClick={onClose}>×</button>
      </header>
      <div className="side-panel-body">
        {error && <p role="alert" className="dashboard-error">{error}</p>}
        {children}
      </div>
    </aside>
  </div>
}
