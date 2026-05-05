import type { Alert, EvacuationCenter, MenuItem, Resident } from '../types/dashboard'

// Sidebar menu items.
// Add new pages here if you also create the matching page component.
export const menuItems: MenuItem[] = [
  { key: 'home', label: 'Home' },
  { key: 'verification', label: 'Verification' },
  { key: 'geoMap', label: 'Geo Map' },
  { key: 'reports', label: 'Reports' },
  { key: 'evacCenters', label: 'Evac Centers' },
]

// Main resident list.
// The dashboard stats, filters, table, map, and export all use this data.
export const residents: Resident[] = [
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
    name: 'Jose dela Cruz',
    sitio: 'Sitio Maligaya',
    constraint: 'Wheelchair',
    status: 'Pending',
    floodZone: false,
    lastUpdated: '3 hours ago',
  },
  {
    id: 3,
    name: 'Lourdes Reyes',
    sitio: 'Sitio Rizal',
    constraint: 'Visual',
    status: 'Verified',
    floodZone: true,
    lastUpdated: 'Yesterday',
  },
  {
    id: 4,
    name: 'Pedro Bautista',
    sitio: 'Sitio Mabuhay',
    constraint: 'Bedridden',
    status: 'Pending',
    floodZone: true,
    lastUpdated: 'Yesterday',
  },
  {
    id: 5,
    name: 'Ana Garcia',
    sitio: 'Sitio Pag-asa',
    constraint: 'Walk Assist',
    status: 'Verified',
    floodZone: true,
    lastUpdated: 'Mar 25',
  },
  {
    id: 6,
    name: 'Ramon Cruz',
    sitio: 'Sitio Mabuhay',
    constraint: 'Wheelchair',
    status: 'Verified',
    floodZone: false,
    lastUpdated: 'Mar 24',
  },
]

// Alert cards shown on the Home page.
export const alerts: Alert[] = [
  {
    id: 1,
    title: '12 registrations awaiting ID verification',
    time: '2 hours ago',
    priority: 'high',
  },
  {
    id: 2,
    title: 'Sitio Pag-asa — 8 residents in flood zone',
    time: '3 hours ago',
    priority: 'medium',
  },
  {
    id: 3,
    title: 'New typhoon advisory issued by PAGASA',
    time: 'Yesterday',
    priority: 'info',
  },
]

// Evacuation center list used by the Evac Centers page and export report.
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
]
