type AppHeaderProps = {
  name: string
  roleLabel: string
  onSignOut: () => void
}

export function AppHeader({ name, roleLabel, onSignOut }: AppHeaderProps) {
  // This is the fixed top header for the whole dashboard.
  return (
    <header className="app-header">
      <div>
        <div className="header-eyebrow">PRIORITYCARE OPERATIONS</div>
        <h1>Emergency response dashboard</h1>
        <p>Cebu City · Live resident and evacuation data</p>
      </div>

      <div className="header-status">
        <span className="live-dot" />
        <span>Live system</span>
      </div>

      <div className="admin-box">
        <span>{roleLabel}</span>
        <strong>{name}</strong>
        <button type="button" className="sign-out-button" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </header>
  )
}
