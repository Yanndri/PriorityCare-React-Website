export function AppHeader() {
  // This is the fixed top header for the whole dashboard.
  return (
    <header className="app-header">
      <div>
        <h1>Dashboard Overview</h1>
        <p>Thursday, Mar 26, 2026 — Brgy. San Roque</p>
      </div>

      <div className="admin-box">
        <span>Welcome back</span>
        <strong>Admin Diaz</strong>
      </div>
    </header>
  )
}
