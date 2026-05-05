// These types define the shape of the dashboard data.
// TypeScript uses them to catch mistakes while coding.

export type MenuKey = 'home' | 'verification' | 'geoMap' | 'reports' | 'evacCenters'

export type Constraint = 'Bedridden' | 'Wheelchair' | 'Visual' | 'Walk Assist'

export type Status = 'Pending' | 'Verified'

export type Resident = {
  id: number
  name: string
  sitio: string
  constraint: Constraint
  status: Status
  floodZone: boolean
  lastUpdated: string
}

export type Alert = {
  id: number
  title: string
  time: string
  priority: 'high' | 'medium' | 'info'
}

export type EvacuationCenter = {
  name: string
  capacity: number
  occupied: number
  status: string
}

export type MenuItem = {
  key: MenuKey
  label: string
}

export type StatCardData = {
  label: string
  value: number
  note: string
  tone: string
}

export type ConstraintStat = {
  label: string
  value: number
  percent: number
}
