import type { MenuItem, MenuKey } from '../types/dashboard'

// Sidebar menu items only.
// All dashboard records are now loaded from Supabase through src/api/dashboardApi.ts.
// Hiding a tab is only a convenience: the backend and the database decide
// what each role may read or change.

// Operational modules shared by Admin (assigned barangay) and Super Admin
// (all barangays or the barangay chosen in the scope selector).
const operationalItems: MenuItem[] = [
  { key: 'verification', label: 'Resident Verification' },
  { key: 'geoMap', label: 'Geospatial Map' },
  { key: 'evacCenters', label: 'Evacuation Centers' },
  { key: 'disasterEvents', label: 'Disaster Events' },
  { key: 'rescueReconciliation', label: 'Missing Persons' },
  { key: 'familyReunification', label: 'Family Reunification' },
  { key: 'dispatch', label: 'Dispatch' },
  { key: 'reports', label: 'Reports' },
  { key: 'dataMining', label: 'Data Mining' },
]

export const adminMenuItems: MenuItem[] = [
  { key: 'home', label: 'Dashboard' },
  ...operationalItems,
]

export const superAdminMenuItems: MenuItem[] = [
  { key: 'home', label: 'System Dashboard' },
  { key: 'barangayOverview', label: 'Barangay Overview' },
  { key: 'adminAccounts', label: 'Admin Account Management' },
  { key: 'responderAccounts', label: 'Rescuer Accounts' },
  ...operationalItems.map((item) =>
    item.key === 'reports' ? { ...item, label: 'Reports and Analytics' } : item,
  ),
  { key: 'activityLogs', label: 'Activity Logs' },
]

// Flaticon UIcons (fi-rs-*) shown next to each tab in the sidebar.
export const menuIcons: Record<MenuKey, string> = {
  home: 'apps',
  verification: 'user-check',
  geoMap: 'map-marker',
  evacCenters: 'building',
  disasterEvents: 'siren-on',
  rescueReconciliation: 'search-location',
  familyReunification: 'family',
  dispatch: 'ambulance',
  reports: 'file-chart-line',
  dataMining: 'chart-histogram',
  barangayOverview: 'map-location-track',
  adminAccounts: 'user-gear',
  responderAccounts: 'id-badge',
  activityLogs: 'list-check',
}
