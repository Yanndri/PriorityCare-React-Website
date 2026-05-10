import type { MenuItem } from '../types/dashboard'

// Sidebar menu items only.
// All dashboard records are now loaded from Supabase through src/api/dashboardApi.ts.
export const menuItems: MenuItem[] = [
  { key: 'home', label: 'Home' },
  { key: 'verification', label: 'Verification' },
  { key: 'geoMap', label: 'Geo Map' },
  { key: 'reports', label: 'Reports' },
  { key: 'dataMining', label: 'Data Mining' },
  { key: 'evacCenters', label: 'Evac Centers' },
]
