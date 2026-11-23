import { menuIcons } from '../data/dashboardData'
import type { MenuItem, MenuKey } from '../types/dashboard'
import { Icon } from './Icon'

type SidebarProps = {
  items: MenuItem[]
  subtitle: string
  activeMenu: MenuKey
  onMenuChange: (menu: MenuKey) => void
}

export function Sidebar({ items, subtitle, activeMenu, onMenuChange }: SidebarProps) {
  // Sidebar menu buttons come from dashboardData.ts, chosen by role in App.tsx.
  // Items are shown under their group heading, in the order they first appear.
  const groups: { name: string | undefined; items: MenuItem[] }[] = []
  for (const item of items) {
    const group = groups.find((g) => g.name === item.group)
    if (group) group.items.push(item)
    else groups.push({ name: item.group, items: [item] })
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-label">
        <span>Menu</span>
        <span>{subtitle}</span>
      </div>

      <nav aria-label="Dashboard sections">
        {groups.map((group) => (
          <div key={group.name ?? 'top'} className="nav-group" role="group" aria-label={group.name}>
            {group.name && <div className="nav-group-title">{group.name}</div>}
            {group.items.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`nav-button ${activeMenu === item.key ? 'active' : ''}`}
                aria-current={activeMenu === item.key ? 'page' : undefined}
                onClick={() => onMenuChange(item.key)}
              >
                <Icon name={menuIcons[item.key] ?? 'apps'} className="nav-icon" />
                <span className="nav-label">{item.label}</span>
              </button>
            ))}
          </div>
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
