import { menuItems } from '../data/dashboardData'
import type { MenuKey } from '../types/dashboard'

type SidebarProps = {
  activeMenu: MenuKey
  onMenuChange: (menu: MenuKey) => void
}

export function Sidebar({ activeMenu, onMenuChange }: SidebarProps) {
  // Sidebar menu buttons are generated from dashboardData.ts.
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">P</span>

        <div>
          <strong>PriorityCare</strong>
          <small>Resident Dashboard</small>
        </div>
      </div>

      <nav>
        {menuItems.map((item) => (
          <button
            key={item.key}
            className={`nav-button ${activeMenu === item.key ? 'active' : ''}`}
            onClick={() => onMenuChange(item.key)}
          >
            <span className="nav-square" />
            {item.label}
          </button>
        ))}
      </nav>
    </aside>
  )
}
