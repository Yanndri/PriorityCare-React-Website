import { Icon } from './Icon'
import logo from '../assets/prioritycare-logo.png'

type AppHeaderProps = {
  name: string
  roleLabel: string
  onSignOut: () => void
}

export function AppHeader({ name, roleLabel, onSignOut }: AppHeaderProps) {
  // This is the fixed top header for the whole dashboard.
  return (
    <header className="app-header">
      <div className="header-brand">
        <span className="brand-mark" aria-hidden="true">
          <img className="brand-logo" src={logo} alt="" />
        </span>
        <div>
          <strong className="brand-name">PRIORITYCARE</strong>
        </div>
      </div>

      <div className="header-status">
        <span className="live-dot" />
        <span>Live system</span>
      </div>

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
