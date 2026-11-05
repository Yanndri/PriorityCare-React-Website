import type { MenuItem, MenuKey } from '../types/dashboard'

// Sidebar menu items only.
// All dashboard records are now loaded from Supabase through src/api/dashboardApi.ts.
// Hiding a tab is only a convenience: the backend and the database decide
// what each role may read or change.

// Operational modules shared by Admin (assigned barangay) and Super Admin
// (all barangays or the barangay chosen in the scope selector). They are
// grouped by when a barangay officer uses them, with plain-language labels.
const BEFORE = 'Before a disaster'
const DURING = 'During a disaster'
const AFTER = 'After a disaster'

// Each tab matches a sub-module in Appendix N (numbers in the comments).
const operationalItems: MenuItem[] = [
  { key: 'population', label: 'Sitios & Population', group: BEFORE },
  { key: 'verification', label: 'Residents', group: BEFORE }, // 1.1, 1.2
  { key: 'evacCenters', label: 'Evacuation Centers', group: BEFORE }, // 2.1, 2.3
  { key: 'disasterEvents', label: 'Declare a Disaster', group: DURING }, // 3.1
  { key: 'geoMap', label: 'Map', group: DURING }, // 3.2
  { key: 'dispatch', label: 'SOS & Rescue', group: DURING }, // 1.3, 2.2
  { key: 'preemptiveEvacuation', label: 'Evacuations', group: DURING }, // 1.3
  { key: 'rescueReconciliation', label: 'Missing & Family Search', group: DURING }, // 4.1
  { key: 'reports', label: 'Reports', group: AFTER }, // 4.2
]

export const adminMenuItems: MenuItem[] = [
  { key: 'home', label: 'Today' },
  ...operationalItems,
]

export const superAdminMenuItems: MenuItem[] = [
  { key: 'home', label: 'Today' },
  { key: 'adminAccounts', label: 'Accounts & Barangays', group: 'Municipal admin' }, // 4.3
  { key: 'activityLogs', label: 'Activity Logs', group: 'Municipal admin' },
  ...operationalItems,
]

// One plain sentence under each page title: what the page is for.
export const pageDescriptions: Record<MenuKey, string> = {
  home: 'What needs your attention right now. Click a card to go straight to it.',
  population: 'Your official sitio list, and how many people live in each sitio: children, seniors, pregnant, and those who cannot walk.',
  verification: 'Register residents, check their IDs, and keep household details up to date.',
  evacCenters: 'Your evacuation centers: how full they are, who is inside, and relief supplies needed.',
  preemptiveEvacuation: 'Which households are staying home, leaving, or safe, and where they went. Residents report from the app; staff can log for them.',
  disasterEvents: 'Declare a flood, fire, earthquake or landslide when it happens, and close it when it is over.',
  geoMap: 'See residents by priority, evacuation centers and SOS calls on the map, plus the vulnerability heatmap.',
  dispatch: 'Answer SOS calls: open a rescue request and send a rescue team.',
  rescueReconciliation: 'Record people reported missing, mark them found, and help families find where a relative is.',
  familyReunification: 'Help someone find out where a family member is: at a center, rescued, or still missing.',
  reports: 'Make the situation report (RDANA), the DSWD relief report (DROMIC) and the evacuation audit trail as PDF or Excel.',
  dataMining: 'Charts about your residents, such as who needs the most help during evacuation.',
  barangayOverview: 'Every barangay at a glance. Click one to open its dashboard.',
  adminAccounts: 'Every barangay at a glance, plus barangay admin and rescuer accounts.',
  responderAccounts: 'Create and manage accounts for accredited rescuers.',
  activityLogs: 'A record of who changed what, and when.',
}

// Flaticon UIcons (fi-rs-*) shown next to each tab in the sidebar.
export const menuIcons: Record<MenuKey, string> = {
  home: 'apps',
  verification: 'user-check',
  population: 'users',
  geoMap: 'map-marker',
  evacCenters: 'building',
  preemptiveEvacuation: 'home',
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
