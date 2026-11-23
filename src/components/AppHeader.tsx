import type { ReactNode } from 'react'
import { Icon } from './Icon'
import logo from '../assets/prioritycare-logo.png'

type AppHeaderProps = {
  name: string
  roleLabel: string
  onSignOut: () => void
  // The barangay being viewed (Admin) or the scope picker (Super Admin).
  scope?: ReactNode
}

export function AppHeader({ name, roleLabel, onSignOut, scope }: AppHeaderProps) {
  // This is the fixed top header for the whole dashboard.
  return (
    <header className="app-header">
      <div className="header-brand">
        <span className="brand-mark" aria-hidden="true">
          <img className="brand-logo" src={logo} alt="" />
        </span>
        <div>
          <strong className="brand-name">PriorityCare</strong>
        </div>
      </div>

      {/* One bar for everything: which barangay you are looking at sits here, not in a second banner. */}
      <div className="header-status">{scope}</div>

      <div className="admin-box">
        <div>
          <span>{roleLabel}</span>
          <strong>{name}</strong>
        </div>
        <button type="button" className="sign-out-button" onClick={onSignOut}>
          <Icon name="sign-out-alt" />
          Sign out
        </button>
      </div>
    </header>
  )
}
