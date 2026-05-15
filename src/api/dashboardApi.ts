import { supabase } from '../lib/supabaseClient'
import type {
  Alert,
  EvacuationCenter,
  EvacuationHistoryRecord,
  Resident,
  VerificationDocument,
} from '../types/dashboard'

export type DashboardData = {
  residents: Resident[]
  alerts: Alert[]
  evacuationCenters: EvacuationCenter[]
  evacuationHistory: EvacuationHistoryRecord[]
}

type AnyRow = Record<string, any>

export type ResidentUpdateInput = {
  name: string
  constraint: Resident['constraint']
  status: Resident['status']
}

export async function updateResidentProfile(residentId: number | string, updates: ResidentUpdateInput) {
  const nameParts = updates.name.trim().split(/\s+/)
  const firstName = nameParts[0] || updates.name.trim()
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : ''

  const { error: userError } = await supabase
    .from('users')
    .update({
      f_name: firstName,
      l_name: lastName,
      is_verified: updates.status === 'Verified',
    })
    .eq('uid', residentId)

  if (userError) {
    throw userError
  }

  const { error: residentError } = await supabase
    .from('residents')
    .update({
      mobility_status: mapConstraintToDatabase(updates.constraint),
    })
    .eq('uid', residentId)

  if (residentError) {
    throw residentError
  }
}

export async function deleteResidentProfile(residentId: number | string) {
  // Delete child records first to avoid foreign key issues.
  await supabase.from('verification_documents').delete().eq('uid', residentId)
  await supabase.from('evacuation_records').delete().eq('resident_uid', residentId)

  const { error: residentError } = await supabase
    .from('residents')
    .delete()
    .eq('uid', residentId)

  if (residentError) {
    throw residentError
  }

  const { error: userError } = await supabase
    .from('users')
    .delete()
    .eq('uid', residentId)

  if (userError) {
    throw userError
  }
}

export async function verifyResidentUser(residentId: number | string) {
  // Marks a resident's linked user account as verified in Supabase.
  // This assumes residents.uid and users.uid are the same value.
  const { error } = await supabase
    .from('users')
    .update({ is_verified: true })
    .eq('uid', residentId)

  if (error) {
    throw error
  }

  // Also mark the resident's submitted verification document as approved.
  // If your database does not require this, the user verification above still succeeds first.
  await updateVerificationDocumentsStatus(residentId, ['approved', 'Approved'])
}

export async function rejectResidentUser(residentId: number | string, reason = 'Rejected by administrator') {
  const { error: userError } = await supabase
    .from('users')
    .update({ is_verified: false })
    .eq('uid', residentId)

  if (userError) {
    throw userError
  }

  await updateVerificationDocumentsStatus(residentId, ['rejected', 'Rejected'], reason)
}

export async function fetchDashboardDataFromSupabase(): Promise<DashboardData> {
  const [
    residentsResult,
    usersResult,
    sitiosResult,
    documentsResult,
    documentTypesResult,
    centersResult,
    recordsResult,
  ] = await Promise.allSettled([
    fetchTable('residents'),
    fetchTable('users'),
    fetchTable('sitios'),
    fetchTable('verification_documents'),
    fetchTable('document_types'),
    fetchTable('evacuation_centers'),
    fetchTable('evacuation_records'),
  ])

  const residentsRows = getSettledValue(residentsResult)
  const usersRows = getSettledValue(usersResult)
  const sitiosRows = getSettledValue(sitiosResult)
  const documentRows = getSettledValue(documentsResult)
  const documentTypeRows = getSettledValue(documentTypesResult)
  const centerRows = getSettledValue(centersResult)
  const recordRows = getSettledValue(recordsResult)

  const usersByUid = toMap(usersRows, ['uid', 'id', 'user_id'])
  const sitiosById = toMap(sitiosRows, ['sitio_id', 'id'])
  const centersById = toMap(centerRows, ['center_id', 'id'])
  const documentTypesById = toMap(documentTypeRows, ['type_id', 'id'])
  const documentsByResidentId = groupDocumentsByResidentId(documentRows, documentTypesById)

  const residents = residentsRows.map((residentRow, index) =>
    mapResident(residentRow, usersByUid, sitiosById, documentsByResidentId, index),
  )

  const evacuationCenters = centerRows.map((centerRow, index) =>
    mapEvacuationCenter(centerRow, recordRows, residentsRows, usersByUid, sitiosById, index),
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

async function updateVerificationDocumentsStatus(
  residentId: number | string,
  statusesToTry: string[],
  rejectionReason?: string,
) {
  for (const status of statusesToTry) {
    const updatePayload: AnyRow = {
      review_status: status,
      reviewed_at: new Date().toISOString(),
    }

    if (rejectionReason) {
      updatePayload.rejection_reason = rejectionReason
    }

    const { error } = await supabase
      .from('verification_documents')
      .update(updatePayload)
      .eq('uid', residentId)

    if (!error) {
      return
    }

    console.warn(`Unable to update document status to ${status}:`, error)
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
  documentsByResidentId: Map<string, VerificationDocument[]>,
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
  const documents = documentsByResidentId.get(String(uid)) ?? []
  const hasRejectedDocument = documents.some((document) => document.reviewStatus === 'Rejected')

  return {
    id: uid ?? `resident-${index + 1}`,
    name: fullNameFromUser || String(rowName ?? `Resident ${index + 1}`),
    sitio: String(getField(sitio, ['sitio_name', 'name']) ?? getField(residentRow, ['sitio', 'sitio_name']) ?? 'Unknown Sitio'),
    constraint: mapConstraint(mobility),
    status:
      Boolean(Number(isVerified)) || verificationStatus === 'verified'
        ? 'Verified'
        : hasRejectedDocument || verificationStatus === 'rejected'
          ? 'Rejected'
          : 'Pending',
    floodZone: latitude !== null && latitude !== undefined && longitude !== null && longitude !== undefined,
    lastUpdated: formatDate(getField(residentRow, ['last_heartbeat', 'updated_at', 'created_at'])),
    sex: String(getField(residentRow, ['sex', 'gender']) ?? 'Not specified'),
    birthdate: formatDate(getField(residentRow, ['birthdate', 'birth_date', 'birthday'])),
    address: String(
      getField(residentRow, ['address', 'physical_address', 'household_address', 'home_address']) ??
        getField(sitio, ['sitio_name', 'name']) ??
        'No address provided',
    ),
    landmark: String(getField(residentRow, ['landmark', 'remarks', 'location_note']) ?? 'No landmark provided'),
    emergencyContactName: String(getField(residentRow, ['emerg_contact_name', 'emergency_contact_name']) ?? 'Not provided'),
    emergencyContactNo: String(getField(residentRow, ['emerg_contact_no', 'emergency_contact_no']) ?? 'Not provided'),
    gpsLat: latitude ?? null,
    gpsLong: longitude ?? null,
    documents,
  }
}

function groupDocumentsByResidentId(
  rows: AnyRow[],
  documentTypesById: Map<string, AnyRow>,
): Map<string, VerificationDocument[]> {
  const grouped = new Map<string, VerificationDocument[]>()

  rows.forEach((row, index) => {
    const residentId = getField(row, ['uid', 'resident_uid', 'user_id'])
    const typeId = getField(row, ['type_id', 'document_type_id'])
    const typeRow = documentTypesById.get(String(typeId))
    const reviewStatus = mapReviewStatus(String(getField(row, ['review_status', 'status']) ?? 'Pending'))

    if (residentId === null || residentId === undefined) {
      return
    }

    const document: VerificationDocument = {
      id: getField(row, ['doc_id', 'id']) ?? `document-${index + 1}`,
      residentId,
      typeName: String(getField(typeRow, ['type_name', 'name']) ?? getField(row, ['document_type', 'type_name']) ?? 'Submitted ID'),
      fileUrl: String(getField(row, ['file_url', 'document_url', 'url', 'file_path']) ?? ''),
      reviewStatus,
      uploadedAt: formatDate(getField(row, ['uploaded_at', 'created_at'])),
      rejectionReason: getField(row, ['rejection_reason', 'remarks']) ?? null,
    }

    const key = String(residentId)
    grouped.set(key, [...(grouped.get(key) ?? []), document])
  })

  return grouped
}

function mapReviewStatus(value: string): VerificationDocument['reviewStatus'] {
  const normalized = value.toLowerCase()

  if (normalized.includes('approved')) return 'Approved'
  if (normalized.includes('rejected')) return 'Rejected'

  return 'Pending'
}

function mapEvacuationCenter(
  centerRow: AnyRow,
  recordRows: AnyRow[],
  residentRows: AnyRow[],
  usersByUid: Map<string, AnyRow>,
  sitiosById: Map<string, AnyRow>,
  index: number,
): EvacuationCenter {
  const centerId = getField(centerRow, ['center_id', 'id'])
  const assignedRecords = recordRows.filter((record) => {
    const recordCenterId = getField(record, ['evac_center_id', 'center_id'])
    return String(recordCenterId) === String(centerId)
  })

  const assignedResidents = assignedRecords.map((record, recordIndex) => {
    const residentUid = getField(record, ['resident_uid', 'uid'])
    const resident = residentRows.find((row) => String(getField(row, ['uid', 'id'])) === String(residentUid))
    const user = usersByUid.get(String(residentUid))
    const sitio = sitiosById.get(String(getField(resident, ['sitio_id', 'sitioId'])))

    const firstName = getField(user, ['f_name', 'first_name', 'firstname'])
    const middleName = getField(user, ['m_name', 'middle_name', 'middlename'])
    const lastName = getField(user, ['l_name', 'last_name', 'lastname'])
    const fullName = [firstName, middleName, lastName].filter(Boolean).join(' ').trim()

    return {
      id: residentUid ?? `center-resident-${index + 1}-${recordIndex + 1}`,
      name: fullName || `Resident ${residentUid ?? recordIndex + 1}`,
      sitio: String(getField(sitio, ['sitio_name', 'name']) ?? getField(resident, ['sitio', 'sitio_name']) ?? 'Unknown Sitio'),
      constraint: mapConstraint(String(getField(resident, ['mobility_status', 'constraint', 'disability_type']) ?? '')),
      evacuationStatus: String(getField(record, ['evac_status', 'status']) ?? 'pending'),
    }
  })

  return {
    id: centerId ?? `center-${index + 1}`,
    name: String(getField(centerRow, ['center_name', 'name']) ?? `Evacuation Center ${index + 1}`),
    capacity: Number(getField(centerRow, ['capacity', 'max_capacity']) ?? 100),
    occupied: assignedResidents.length,
    status: String(getField(centerRow, ['status', 'center_status']) ?? 'Open'),
    residents: assignedResidents,
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
    id: getField(recordRow, ['record_id', 'id']) ?? `evacuation-record-${index + 1}`,
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

function mapConstraintToDatabase(value: Resident['constraint']) {
  if (value === 'Bedridden') return 'Bedridden'
  if (value === 'Wheelchair') return 'Wheelchair'
  if (value === 'Visual') return 'Visual'
  return 'Assisted'
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

  if (normalized.includes('safe') || normalized.includes('evacuated')) return 'Safely Evacuated'
  if (normalized.includes('missing') || normalized.includes('relocated') || normalized.includes('failed')) return 'Missing / Relocated'
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
