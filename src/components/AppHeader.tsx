export function AppHeader() {
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
        <span>Welcome back</span>
        <strong>Admin Diaz</strong>
      </div>
    </header>
  )
}
