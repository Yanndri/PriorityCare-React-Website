import { menuIcons } from '../data/dashboardData'
import type { MenuItem, MenuKey } from '../types/dashboard'
import { Icon } from './Icon'

type SidebarProps = {
  items: MenuItem[]
  subtitle: string
  activeMenu: MenuKey
  onMenuChange: (menu: MenuKey) => void
}

const sectionNumber = (index: number) => String(Math.max(index, 0)).padStart(2, '0')

export function Sidebar({ items, subtitle, activeMenu, onMenuChange }: SidebarProps) {
  // Sidebar menu buttons come from dashboardData.ts, chosen by role in App.tsx.
  return (
    <aside className="sidebar">
      <div className="sidebar-label">
        <span>Index</span>
        <span>{subtitle}</span>
      </div>

      <nav aria-label="Dashboard sections">
        {items.map((item, index) => (
          <button
            key={item.key}
            type="button"
            className={`nav-button ${activeMenu === item.key ? 'active' : ''}`}
            aria-current={activeMenu === item.key ? 'page' : undefined}
            onClick={() => onMenuChange(item.key)}
          >
            <span className="nav-index">[ {sectionNumber(index)} ]</span>
            <Icon name={menuIcons[item.key] ?? 'apps'} className="nav-icon" />
            <span className="nav-label">{item.label}</span>
          </button>
        ))}
      </nav>

      <p className="sidebar-credit">
        Icons:{' '}
        <a href="https://www.flaticon.com/uicons" target="_blank" rel="noreferrer">
          Uicons by Flaticon
        </a>
      </p>
    </aside>
  )
}
