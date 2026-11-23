import type { MenuItem, MenuKey } from '../types/dashboard'

// Sidebar menu items only.
// All dashboard records are now loaded from Supabase through src/api/dashboardApi.ts.
// Hiding a tab is only a convenience: the backend and the database decide
// what each role may read or change.

// Operational modules shared by Admin (assigned barangay) and Super Admin
// (all barangays or the barangay chosen in the scope selector). The groups
// follow the order of the work: respond to an alarm and run the operation,
// keep records ready before one, then review afterwards.
const RESPOND = 'Respond'
const PREPARE = 'Prepare'
const REVIEW = 'Review'

// Each tab matches a sub-module in Appendix N (numbers in the comments).
// Pages that are a tab of another menu item are listed in menuParent below.
const operationalItems: MenuItem[] = [
  { key: 'disasterEvents', label: 'Alarms', group: RESPOND }, // 3.1 hazard reports -> Yes/No -> declare
  { key: 'dispatch', label: 'Operation', group: RESPOND }, // 1.3, 2.2, 4.1 (tabs: rescue, evacuation, missing)
  { key: 'geoMap', label: 'Map', group: RESPOND }, // 3.2
  { key: 'verification', label: 'Residents', group: PREPARE }, // 1.1, 1.2 (tabs: residents, sitios)
  { key: 'evacCenters', label: 'Evacuation centers', group: PREPARE }, // 2.1, 2.3
  { key: 'responderTeams', label: 'Responder teams', group: PREPARE },
  { key: 'reports', label: 'Situation report', group: REVIEW }, // 4.2
  { key: 'dataMining', label: 'Data mining', group: REVIEW }, // UC-13: priority zones, center demand, response time
  { key: 'activityLogs', label: 'Activity log', group: REVIEW }, // 4.4
]

export const adminMenuItems: MenuItem[] = [
  { key: 'home', label: 'Today' },
  ...operationalItems,
]

export const superAdminMenuItems: MenuItem[] = [
  { key: 'home', label: 'Today' },
  ...operationalItems,
  { key: 'adminAccounts', label: 'Accounts & barangays', group: 'Municipal admin' }, // 4.3
]

// Pages shown as a tab of another menu item: the sidebar highlights the parent.
export const menuParent: Partial<Record<MenuKey, MenuKey>> = {
  preemptiveEvacuation: 'dispatch',
  rescueReconciliation: 'dispatch',
  population: 'verification',
}

// Tab names inside the merged pages.
export const tabLabels: Partial<Record<MenuKey, string>> = {
  dispatch: 'Rescue requests',
  preemptiveEvacuation: 'Who has evacuated',
  rescueReconciliation: 'Missing persons',
  verification: 'Residents',
  population: 'Sitios & population',
}

// One plain sentence under each page title: what the page is for.
export const pageDescriptions: Record<MenuKey, string> = {
  home: 'How things stand right now, and what to do next.',
  population: 'Your official sitio list, and how many people live in each sitio: children, seniors, pregnant, and those who cannot walk.',
  verification: 'Register residents, check their IDs, and keep household details up to date.',
  evacCenters: 'Your evacuation centers: how full they are and who is inside.',
  preemptiveEvacuation: 'Which households are staying home, leaving, or safe, and where they went. Residents report from the app; staff can log for them.',
  disasterEvents: 'Hazards reported from the app. Check each one outside the system, answer Yes or No, and declare a disaster when it is real.',
  geoMap: 'See residents by priority, evacuation centers and SOS calls on the map, plus the vulnerability heatmap.',
  dispatch: 'Everything during a declared disaster: rescue requests, who has evacuated, and missing persons.',
  rescueReconciliation: 'Record people reported missing, mark them found, and search the rescued list to tell families where a relative is.',
  reports: 'Make the 24/48-hour situation report (RDANA).',
  responderTeams: 'Responder teams that can be sent to rescue requests, and who is in each team.',
  dataMining: 'Find where the households that need help are grouped, which evacuation centers may run out of space, and how fast rescues are.',
  barangayOverview: 'Every barangay at a glance. Click one to open its dashboard.',
  adminAccounts: 'Every barangay at a glance, plus barangay admin and responder accounts.',
  responderAccounts: 'Create and manage accounts for accredited responders.',
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
  disasterEvents: 'bell',
  rescueReconciliation: 'search-location',
  dispatch: 'ambulance',
  responderTeams: 'users-alt',
  reports: 'file-chart-line',
  dataMining: 'chart-histogram',
  barangayOverview: 'map-location-track',
  adminAccounts: 'user-gear',
  responderAccounts: 'id-badge',
  activityLogs: 'list-check',
}
