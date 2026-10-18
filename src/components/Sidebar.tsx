import type { MenuItem, MenuKey } from '../types/dashboard'

type SidebarProps = {
  items: MenuItem[]
  subtitle: string
  activeMenu: MenuKey
  onMenuChange: (menu: MenuKey) => void
}

export function Sidebar({ items, subtitle, activeMenu, onMenuChange }: SidebarProps) {
  // Sidebar menu buttons come from dashboardData.ts, chosen by role in App.tsx.
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">P</span>

        <div>
          <strong>PriorityCare</strong>
          <small>{subtitle}</small>
        </div>
      </div>

      <nav>
        {items.map((item) => (
          <button
            key={item.key}
            className={`nav-button ${activeMenu === item.key ? 'active' : ''}`}
            aria-current={activeMenu === item.key ? 'page' : undefined}
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
