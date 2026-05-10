import { supabase } from '../lib/supabaseClient'
import type {
  Alert,
  EvacuationCenter,
  EvacuationHistoryRecord,
  Resident,
} from '../types/dashboard'

export type DashboardData = {
  residents: Resident[]
  alerts: Alert[]
  evacuationCenters: EvacuationCenter[]
  evacuationHistory: EvacuationHistoryRecord[]
}

type AnyRow = Record<string, any>

export async function fetchDashboardDataFromSupabase(): Promise<DashboardData> {
  const [
    residentsResult,
    usersResult,
    sitiosResult,
    documentsResult,
    centersResult,
    recordsResult,
  ] = await Promise.allSettled([
    fetchTable('residents'),
    fetchTable('users'),
    fetchTable('sitios'),
    fetchTable('verification_documents'),
    fetchTable('evacuation_centers'),
    fetchTable('evacuation_records'),
  ])

  const residentsRows = getSettledValue(residentsResult)
  const usersRows = getSettledValue(usersResult)
  const sitiosRows = getSettledValue(sitiosResult)
  const documentRows = getSettledValue(documentsResult)
  const centerRows = getSettledValue(centersResult)
  const recordRows = getSettledValue(recordsResult)

  if (residentsRows.length === 0) {
    throw new Error('No residents were loaded from Supabase.')
  }

  const usersByUid = toMap(usersRows, ['uid', 'id', 'user_id'])
  const sitiosById = toMap(sitiosRows, ['sitio_id', 'id'])
  const centersById = toMap(centerRows, ['center_id', 'id'])

  const residents = residentsRows.map((residentRow, index) =>
    mapResident(residentRow, usersByUid, sitiosById, index),
  )

  const evacuationCenters = centerRows.map((centerRow, index) =>
    mapEvacuationCenter(centerRow, recordRows, index),
  )

  const evacuationHistory = recordRows.map((recordRow, index) =>
    mapEvacuationHistory(recordRow, usersByUid, sitiosById, centersById, residentsRows, index),
  )

  const pendingDocuments = documentRows.filter((row) => {
    const status = String(getField(row, ['review_status', 'status']) ?? '').toLowerCase()
    return status === 'pending'
  }).length

  const mappedResidents = residents.filter((resident) => resident.floodZone).length

  const alerts: Alert[] = [
    {
      id: 1,
      title: `${pendingDocuments} registrations awaiting document verification`,
      time: 'Live Supabase data',
      priority: 'high',
    },
    {
      id: 2,
      title: `${mappedResidents} residents with mapped coordinates`,
      time: 'Live Supabase data',
      priority: 'medium',
    },
    {
      id: 3,
      title: 'Supabase connection active',
      time: 'Live Supabase data',
      priority: 'info',
    },
  ]

  return {
    residents,
    alerts,
    evacuationCenters,
    evacuationHistory,
  }
}

async function fetchTable(tableName: string) {
  const { data, error } = await supabase.from(tableName).select('*')

  if (error) {
    throw error
  }

  return data ?? []
}

function getSettledValue(result: PromiseSettledResult<AnyRow[]>) {
  if (result.status === 'fulfilled') {
    return result.value
  }

  console.warn('Supabase table load failed:', result.reason)
  return []
}

function mapResident(
  residentRow: AnyRow,
  usersByUid: Map<string, AnyRow>,
  sitiosById: Map<string, AnyRow>,
  index: number,
): Resident {
  const uid = getField(residentRow, ['uid', 'id', 'resident_uid'])
  const user = usersByUid.get(String(uid))
  const sitioId = getField(residentRow, ['sitio_id', 'sitioId'])
  const sitio = sitiosById.get(String(sitioId))

  const firstName = getField(user, ['f_name', 'first_name', 'firstname'])
  const middleName = getField(user, ['m_name', 'middle_name', 'middlename'])
  const lastName = getField(user, ['l_name', 'last_name', 'lastname'])
  const fullNameFromUser = [firstName, middleName, lastName].filter(Boolean).join(' ').trim()

  const rowName = getField(residentRow, ['full_name', 'name', 'resident_name'])
  const mobility = String(getField(residentRow, ['mobility_status', 'constraint', 'disability_type']) ?? '')
  const latitude = getField(residentRow, ['GPS_Lat', 'gps_lat', 'latitude', 'lat'])
  const longitude = getField(residentRow, ['GPS_Long', 'gps_long', 'longitude', 'lng', 'long'])
  const isVerified = getField(user, ['is_verified', 'verified']) ?? getField(residentRow, ['is_verified', 'verified'])
  const verificationStatus = String(getField(residentRow, ['verification_status', 'status']) ?? '').toLowerCase()

  return {
    id: Number(uid ?? index + 1),
    name: fullNameFromUser || String(rowName ?? `Resident ${index + 1}`),
    sitio: String(getField(sitio, ['sitio_name', 'name']) ?? getField(residentRow, ['sitio', 'sitio_name']) ?? 'Unknown Sitio'),
    constraint: mapConstraint(mobility),
    status: Boolean(Number(isVerified)) || verificationStatus === 'verified' ? 'Verified' : 'Pending',
    floodZone: latitude !== null && latitude !== undefined && longitude !== null && longitude !== undefined,
    lastUpdated: formatDate(getField(residentRow, ['last_heartbeat', 'updated_at', 'created_at'])),
  }
}

function mapEvacuationCenter(
  centerRow: AnyRow,
  recordRows: AnyRow[],
  index: number,
): EvacuationCenter {
  const centerId = getField(centerRow, ['center_id', 'id'])
  const occupied = recordRows.filter((record) => {
    const recordCenterId = getField(record, ['evac_center_id', 'center_id'])
    return String(recordCenterId) === String(centerId)
  }).length

  return {
    name: String(getField(centerRow, ['center_name', 'name']) ?? `Evacuation Center ${index + 1}`),
    capacity: Number(getField(centerRow, ['capacity', 'max_capacity']) ?? 100),
    occupied,
    status: String(getField(centerRow, ['status', 'center_status']) ?? 'Open'),
  }
}

function mapEvacuationHistory(
  recordRow: AnyRow,
  usersByUid: Map<string, AnyRow>,
  sitiosById: Map<string, AnyRow>,
  centersById: Map<string, AnyRow>,
  residentRows: AnyRow[],
  index: number,
): EvacuationHistoryRecord {
  const residentUid = getField(recordRow, ['resident_uid', 'uid'])
  const resident = residentRows.find((row) => String(getField(row, ['uid', 'id'])) === String(residentUid))
  const user = usersByUid.get(String(residentUid))
  const sitio = sitiosById.get(String(getField(resident, ['sitio_id', 'sitioId'])))
  const center = centersById.get(String(getField(recordRow, ['evac_center_id', 'center_id'])))

  const firstName = getField(user, ['f_name', 'first_name', 'firstname'])
  const middleName = getField(user, ['m_name', 'middle_name', 'middlename'])
  const lastName = getField(user, ['l_name', 'last_name', 'lastname'])
  const residentName = [firstName, middleName, lastName].filter(Boolean).join(' ').trim()

  const loggedAt = getField(recordRow, ['logged_at', 'created_at'])
  const evacuatedAt = getField(recordRow, ['evacuated_at', 'updated_at'])
  const responseMinutes = getResponseMinutes(loggedAt, evacuatedAt)

  const latitude = getField(resident, ['GPS_Lat', 'gps_lat', 'latitude', 'lat'])
  const longitude = getField(resident, ['GPS_Long', 'gps_long', 'longitude', 'lng', 'long'])

  return {
    id: index + 1,
    residentName: residentName || `Resident ${residentUid ?? index + 1}`,
    sitio: String(getField(sitio, ['sitio_name', 'name']) ?? getField(resident, ['sitio', 'sitio_name']) ?? 'Unknown Sitio'),
    constraint: mapConstraint(String(getField(resident, ['mobility_status', 'constraint', 'disability_type']) ?? '')),
    status: mapEvacuationStatus(String(getField(recordRow, ['evac_status', 'status']) ?? 'Pending')),
    evacuationCenter: String(getField(center, ['center_name', 'name']) ?? 'Unassigned'),
    disasterEvent: String(getField(recordRow, ['disaster_event', 'event_name']) ?? 'Recorded Disaster Event'),
    month: getMonthName(loggedAt),
    year: getYear(loggedAt),
    responseMinutes,
    floodZone: latitude !== null && latitude !== undefined && longitude !== null && longitude !== undefined,
  }
}

function toMap(rows: AnyRow[], keys: string[]) {
  const map = new Map<string, AnyRow>()

  rows.forEach((row) => {
    const key = getField(row, keys)

    if (key !== null && key !== undefined) {
      map.set(String(key), row)
    }
  })

  return map
}

function getField(row: AnyRow | undefined, keys: string[]) {
  if (!row) {
    return undefined
  }

  for (const key of keys) {
    if (row[key] !== undefined) {
      return row[key]
    }
  }

  return undefined
}

function mapConstraint(value: string): Resident['constraint'] {
  const normalized = value.toLowerCase()

  if (normalized.includes('bed')) return 'Bedridden'
  if (normalized.includes('wheel')) return 'Wheelchair'
  if (normalized.includes('visual')) return 'Visual'

  return 'Walk Assist'
}

function mapEvacuationStatus(value: string): EvacuationHistoryRecord['status'] {
  const normalized = value.toLowerCase()

  if (normalized.includes('safely')) return 'Safely Evacuated'
  if (normalized.includes('missing') || normalized.includes('relocated')) return 'Missing / Relocated'
  if (normalized.includes('transit') || normalized.includes('extracted')) return 'In Transit'

  return 'Pending'
}

function formatDate(value: unknown) {
  if (!value) {
    return 'No update'
  }

  const date = new Date(String(value))

  if (Number.isNaN(date.getTime())) {
    return String(value)
  }

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

function getMonthName(value: unknown) {
  const date = value ? new Date(String(value)) : new Date()

  if (Number.isNaN(date.getTime())) {
    return 'Unknown'
  }

  return date.toLocaleString(undefined, { month: 'long' })
}

function getYear(value: unknown) {
  const date = value ? new Date(String(value)) : new Date()

  if (Number.isNaN(date.getTime())) {
    return new Date().getFullYear()
  }

  return date.getFullYear()
}

function getResponseMinutes(start: unknown, end: unknown) {
  if (!start || !end) {
    return 0
  }

  const startDate = new Date(String(start))
  const endDate = new Date(String(end))

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return 0
  }

  return Math.max(0, Math.round((endDate.getTime() - startDate.getTime()) / 60000))
}
