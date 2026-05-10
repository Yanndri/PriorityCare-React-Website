import type {
  Alert,
  EvacuationCenter,
  EvacuationHistoryRecord,
  MenuItem,
  Resident,
} from '../types/dashboard'

// ==============================
// SIDEBAR MENU
// ==============================

export const menuItems: MenuItem[] = [
  { key: 'home', label: 'Home' },

  { key: 'verification', label: 'Verification' },

  { key: 'geoMap', label: 'Geo Map' },

  { key: 'reports', label: 'Reports' },

  { key: 'dataMining', label: 'Data Mining' },

  { key: 'evacCenters', label: 'Evac Centers' },
]

// ==============================
// MAIN RESIDENT DATA
// ==============================

export const residents: Resident[] = [

  // ==============================
  // HIGH PRIORITY
  // ==============================

  {
    id: 1,

    name: 'Maria Santos',

    sitio: 'Sitio Pag-asa',

    constraint: 'Bedridden',

    status: 'Pending',

    floodZone: true,

    lastUpdated: '2 hours ago',
  },

  {
    id: 2,

    name: 'Pedro Bautista',

    sitio: 'Sitio Mabuhay',

    constraint: 'Bedridden',

    status: 'Pending',

    floodZone: true,

    lastUpdated: 'Yesterday',
  },

  // ==============================
  // MEDIUM PRIORITY
  // ==============================

  {
    id: 3,

    name: 'Jose dela Cruz',

    sitio: 'Sitio Maligaya',

    constraint: 'Wheelchair',

    status: 'Pending',

    floodZone: true,

    lastUpdated: '3 hours ago',
  },

  {
    id: 4,

    name: 'Ramon Cruz',

    sitio: 'Sitio Riverside',

    constraint: 'Wheelchair',

    status: 'Verified',

    floodZone: true,

    lastUpdated: 'Mar 24',
  },

  // ==============================
  // LOW PRIORITY
  // ==============================

  {
    id: 5,

    name: 'Lourdes Reyes',

    sitio: 'Sitio Rizal',

    constraint: 'Visual',

    status: 'Verified',

    floodZone: true,

    lastUpdated: 'Yesterday',
  },

  {
    id: 6,

    name: 'Ana Garcia',

    sitio: 'Sitio Pag-asa',

    constraint: 'Walk Assist',

    status: 'Verified',

    floodZone: true,

    lastUpdated: 'Mar 25',
  },

  // ==============================
  // SAFE / NOT FLOOD ZONE
  // ==============================

  {
    id: 7,

    name: 'Carlos Mendoza',

    sitio: 'Sitio Riverside',

    constraint: 'Walk Assist',

    status: 'Verified',

    floodZone: false,

    lastUpdated: 'Today',
  },

  {
    id: 8,

    name: 'Nina Lopez',

    sitio: 'Sitio Greenfield',

    constraint: 'Visual',

    status: 'Pending',

    floodZone: false,

    lastUpdated: '1 hour ago',
  },
]

// ==============================
// ALERTS
// ==============================

export const alerts: Alert[] = [
  {
    id: 1,

    title:
      '12 registrations awaiting ID verification',

    time: '2 hours ago',

    priority: 'high',
  },

  {
    id: 2,

    title:
      'Sitio Pag-asa — 8 residents in flood zone',

    time: '3 hours ago',

    priority: 'medium',
  },

  {
    id: 3,

    title:
      'New typhoon advisory issued by PAGASA',

    time: 'Yesterday',

    priority: 'info',
  },

  {
    id: 4,

    title:
      '2 bedridden residents require immediate rescue',

    time: '30 minutes ago',

    priority: 'high',
  },

  {
    id: 5,

    title:
      'Community Gym nearing evacuation capacity',

    time: '1 hour ago',

    priority: 'medium',
  },
]

// ==============================
// EVACUATION CENTERS
// ==============================

export const evacuationCenters: EvacuationCenter[] = [
  {
    name: 'San Roque Covered Court',

    capacity: 120,

    occupied: 38,

    status: 'Open',
  },

  {
    name: 'Elementary School Gym',

    capacity: 90,

    occupied: 20,

    status: 'Standby',
  },

  {
    name: 'Barangay Hall Annex',

    capacity: 55,

    occupied: 8,

    status: 'Open',
  },

  {
    name: 'Community Gymnasium',

    capacity: 150,

    occupied: 92,

    status: 'Open',
  },

  {
    name: 'Sitio Mabuhay Chapel',

    capacity: 40,

    occupied: 15,

    status: 'Standby',
  },
]

// ==============================
// EVACUATION HISTORY / DATA MINING
// ==============================
// This sample historical data powers the Data Mining page.
// Later, you can replace this array with API data from your database.

export const evacuationHistory: EvacuationHistoryRecord[] = [
  {
    id: 1,
    residentName: 'Maria Santos',
    sitio: 'Sitio Pag-asa',
    constraint: 'Bedridden',
    status: 'Safely Evacuated',
    evacuationCenter: 'San Roque Covered Court',
    disasterEvent: 'Typhoon Agaton',
    month: 'June',
    year: 2025,
    responseMinutes: 38,
    floodZone: true,
  },
  {
    id: 2,
    residentName: 'Pedro Bautista',
    sitio: 'Sitio Mabuhay',
    constraint: 'Bedridden',
    status: 'Missing / Relocated',
    evacuationCenter: 'Unassigned',
    disasterEvent: 'Typhoon Agaton',
    month: 'June',
    year: 2025,
    responseMinutes: 74,
    floodZone: true,
  },
  {
    id: 3,
    residentName: 'Jose dela Cruz',
    sitio: 'Sitio Maligaya',
    constraint: 'Wheelchair',
    status: 'In Transit',
    evacuationCenter: 'Elementary School Gym',
    disasterEvent: 'Habagat Flooding',
    month: 'July',
    year: 2025,
    responseMinutes: 52,
    floodZone: true,
  },
  {
    id: 4,
    residentName: 'Ramon Cruz',
    sitio: 'Sitio Riverside',
    constraint: 'Wheelchair',
    status: 'Safely Evacuated',
    evacuationCenter: 'Community Gymnasium',
    disasterEvent: 'Habagat Flooding',
    month: 'July',
    year: 2025,
    responseMinutes: 47,
    floodZone: true,
  },
  {
    id: 5,
    residentName: 'Lourdes Reyes',
    sitio: 'Sitio Rizal',
    constraint: 'Visual',
    status: 'Safely Evacuated',
    evacuationCenter: 'Barangay Hall Annex',
    disasterEvent: 'Typhoon Bising',
    month: 'September',
    year: 2025,
    responseMinutes: 26,
    floodZone: true,
  },
  {
    id: 6,
    residentName: 'Ana Garcia',
    sitio: 'Sitio Pag-asa',
    constraint: 'Walk Assist',
    status: 'Safely Evacuated',
    evacuationCenter: 'San Roque Covered Court',
    disasterEvent: 'Typhoon Bising',
    month: 'September',
    year: 2025,
    responseMinutes: 31,
    floodZone: true,
  },
  {
    id: 7,
    residentName: 'Carlos Mendoza',
    sitio: 'Sitio Riverside',
    constraint: 'Walk Assist',
    status: 'Safely Evacuated',
    evacuationCenter: 'Community Gymnasium',
    disasterEvent: 'Typhoon Odette Drill',
    month: 'November',
    year: 2025,
    responseMinutes: 28,
    floodZone: false,
  },
  {
    id: 8,
    residentName: 'Nina Lopez',
    sitio: 'Sitio Greenfield',
    constraint: 'Visual',
    status: 'Pending',
    evacuationCenter: 'Unassigned',
    disasterEvent: 'Typhoon Odette Drill',
    month: 'November',
    year: 2025,
    responseMinutes: 65,
    floodZone: false,
  },
]
