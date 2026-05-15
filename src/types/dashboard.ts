// These types define the shape of the dashboard data.
// TypeScript uses them to catch mistakes while coding.

export type MenuKey =
  | 'home'
  | 'verification'
  | 'geoMap'
  | 'reports'
  | 'dataMining'
  | 'evacCenters'

export type Constraint = 'Bedridden' | 'Wheelchair' | 'Visual' | 'Walk Assist'

export type Status = 'Pending' | 'Verified' | 'Rejected'

export type VerificationDocument = {
  id: number | string
  residentId: number | string
  typeName: string
  fileUrl: string
  reviewStatus: 'Pending' | 'Approved' | 'Rejected'
  uploadedAt: string
  rejectionReason?: string | null
}

export type Resident = {
  id: number | string
  name: string
  sitio: string
  constraint: Constraint
  status: Status
  floodZone: boolean
  lastUpdated: string
  sex?: string
  birthdate?: string
  address?: string
  landmark?: string
  emergencyContactName?: string
  emergencyContactNo?: string
  gpsLat?: number | string | null
  gpsLong?: number | string | null
  documents?: VerificationDocument[]
}

export type Alert = {
  id: number
  title: string
  time: string
  priority: 'high' | 'medium' | 'info'
}

export type EvacuationCenterResident = {
  id: number | string
  name: string
  sitio: string
  constraint: Constraint
  evacuationStatus: string
}

export type EvacuationCenter = {
  id?: number | string
  name: string
  capacity: number
  occupied: number
  status: string
  residents?: EvacuationCenterResident[]
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

export type EvacuationHistoryRecord = {
  id: number | string
  residentName: string
  sitio: string
  constraint: Constraint
  status: 'Safely Evacuated' | 'Missing / Relocated' | 'Pending' | 'In Transit'
  evacuationCenter: string
  disasterEvent: string
  month: string
  year: number
  responseMinutes: number
  floodZone: boolean
}
