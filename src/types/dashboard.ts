// These types define the shape of the dashboard data.
// TypeScript uses them to catch mistakes while coding.

export type MenuKey =
  | 'home'
  | 'verification'
  | 'geoMap'
  | 'disasterEvents'
  | 'rescueReconciliation'
  | 'familyReunification'
  | 'dispatch'
  | 'reports'
  | 'dataMining'
  | 'evacCenters'
  // Super Admin only
  | 'barangayOverview'
  | 'adminAccounts'
  | 'responderAccounts'
  | 'activityLogs'

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
  barangay: string
  constraint: Constraint
  status: Status
  floodZone: boolean
  lastUpdated: string
  sex?: string
  birthdate?: string
  mobilityStatus?: string
  disabilityCount?: number
  isPregnant?: boolean
  householdId?: string
  /** Names from disability_types; undefined when the disability assessment was never loaded. */
  disabilityTypes?: string[]
  householdName?: string
  isHouseholdHead?: boolean
  vulnerabilityNeeds?: string
  householdMembers?: {
    member_id?: string
    name: string
    relationship: string
    birthdate: string
    sex: string
    is_pregnant: boolean
    needs: string
    mobility?: string
    age_group?: string
  }[]
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
  barangay: string
  constraint: Constraint
  evacuationStatus: string
}

export type EvacuationCenter = {
  closedAt?: string | null
  closureReason?: string | null
  capacityConfirmed?: boolean
  occupancyKnown?: boolean
  facilityType?: string
  barangayId?: number | null
  barangayName?: string | null
  // False when this admin can see the centre (their shelter plan uses it) but not change it.
  editable?: boolean
  households?: number
  gpsLat?: number
  gpsLong?: number
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
  barangay: string
  constraint: Constraint
  status: 'Safely Evacuated' | 'Missing / Relocated' | 'Pending' | 'In Transit'
  evacuationCenter: string
  disasterEvent: string
  month: string
  year: number
  responseMinutes: number
  floodZone: boolean
}
