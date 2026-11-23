import { menuIcons, menuParent } from '../data/dashboardData'
import type { MenuItem, MenuKey } from '../types/dashboard'
import { Icon } from './Icon'

type SidebarProps = {
  items: MenuItem[]
  subtitle: string
  activeMenu: MenuKey
  onMenuChange: (menu: MenuKey) => void
  // Red counts / state next to an item, e.g. new alarms or a running operation.
  badges?: Partial<Record<MenuKey, { text: string; tone: 'urgent' | 'quiet' }>>
}

export function Sidebar({ items, subtitle, activeMenu, onMenuChange, badges = {} }: SidebarProps) {
  // A page shown as a tab of another item (e.g. Missing persons in Operation) highlights that item.
  const current = menuParent[activeMenu] ?? activeMenu
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
                className={`nav-button ${current === item.key ? 'active' : ''}`}
                aria-current={current === item.key ? 'page' : undefined}
                onClick={() => onMenuChange(item.key)}
              >
                <Icon name={menuIcons[item.key] ?? 'apps'} className="nav-icon" />
                <span className="nav-label">{item.label}</span>
                {badges[item.key] && (
                  <span className={`nav-badge nav-badge-${badges[item.key]!.tone}`}>{badges[item.key]!.text}</span>
                )}
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
