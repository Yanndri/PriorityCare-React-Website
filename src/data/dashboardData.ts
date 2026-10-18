import type { MenuItem } from '../types/dashboard'

// Sidebar menu items only.
// All dashboard records are now loaded from Supabase through src/api/dashboardApi.ts.
// Hiding a tab is only a convenience: the backend and the database decide
// what each role may read or change.

// Operational modules shared by Admin (assigned sitio) and Super Admin
// (all sitios or the sitio chosen in the scope selector).
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
  { key: 'sitioOverview', label: 'Sitio Overview' },
  { key: 'adminAccounts', label: 'Admin Account Management' },
  ...operationalItems.map((item) =>
    item.key === 'reports' ? { ...item, label: 'Reports and Analytics' } : item,
  ),
  { key: 'activityLogs', label: 'Activity Logs' },
]
