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

const operationalItems: MenuItem[] = [
  { key: 'verification', label: 'Residents', group: BEFORE },
  { key: 'evacCenters', label: 'Evacuation Centers', group: BEFORE },
  { key: 'preemptiveEvacuation', label: 'Pre-emptive Evacuation', group: BEFORE },
  { key: 'disasterEvents', label: 'Declare a Disaster', group: DURING },
  { key: 'geoMap', label: 'Map', group: DURING },
  { key: 'dispatch', label: 'SOS & Rescue Teams', group: DURING },
  { key: 'rescueReconciliation', label: 'Missing Persons', group: DURING },
  { key: 'familyReunification', label: 'Find a Family Member', group: DURING },
  { key: 'reports', label: 'Situation & Relief Reports', group: AFTER },
  { key: 'dataMining', label: 'Charts', group: AFTER },
]

export const adminMenuItems: MenuItem[] = [
  { key: 'home', label: 'Today' },
  ...operationalItems,
]

export const superAdminMenuItems: MenuItem[] = [
  { key: 'home', label: 'Today' },
  { key: 'barangayOverview', label: 'Barangay Overview', group: 'Municipal admin' },
  { key: 'adminAccounts', label: 'Admin Accounts', group: 'Municipal admin' },
  { key: 'responderAccounts', label: 'Rescuer Accounts', group: 'Municipal admin' },
  { key: 'activityLogs', label: 'Activity Logs', group: 'Municipal admin' },
  ...operationalItems,
]

// One plain sentence under each page title: what the page is for.
export const pageDescriptions: Record<MenuKey, string> = {
  home: 'What needs your attention right now. Click a card to go straight to it.',
  verification: 'Register residents, check their IDs, and keep household details up to date.',
  evacCenters: 'Your evacuation centers: how full they are, who is inside, and relief supplies needed.',
  preemptiveEvacuation: 'Before a disaster hits, record which households are staying home or leaving, and where they are going.',
  disasterEvents: 'Declare a flood, fire, earthquake or landslide when it happens, and close it when it is over.',
  geoMap: 'See residents, evacuation centers and SOS calls on the map.',
  dispatch: 'Answer SOS calls: open a rescue request and send a rescue team.',
  rescueReconciliation: 'Record people reported missing and mark them found.',
  familyReunification: 'Help someone find out where a family member is: at a center, rescued, or still missing.',
  reports: 'Make the situation report (RDANA) and the DSWD relief report (DROMIC) as PDF or Excel.',
  dataMining: 'Charts about your residents, such as who needs the most help during evacuation.',
  barangayOverview: 'Every barangay at a glance. Click one to open its dashboard.',
  adminAccounts: 'Create barangay admin accounts, suspend them, or move them to another barangay.',
  responderAccounts: 'Create and manage accounts for accredited rescuers.',
  activityLogs: 'A record of who changed what, and when.',
}

// Flaticon UIcons (fi-rs-*) shown next to each tab in the sidebar.
export const menuIcons: Record<MenuKey, string> = {
  home: 'apps',
  verification: 'user-check',
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
