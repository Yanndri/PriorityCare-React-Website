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

// A loosely-shaped database row; fields are narrowed where they are read.
type AnyRow = Record<string, unknown>

// Stand-in for a query that is skipped because there are no residents.
const EMPTY_ROWS_RESULT: { data: AnyRow[]; error: null } = {
  data: [],
  error: null,
}

// Delete a resident profile and its related records.
export async function deleteResidentProfile(
  residentId: number | string,
) {
  const { error: documentsError } = await supabase
    .from('verification_documents')
    .delete()
    .eq('uid', residentId)

  if (documentsError) throw documentsError

  const { error: recordsError } = await supabase
    .from('evacuation_records')
    .delete()
    .eq('resident_uid', residentId)

  if (recordsError) throw recordsError

  const { error: residentError } = await supabase
    .from('residents')
    .delete()
    .eq('uid', residentId)

  if (residentError) throw residentError

  const { error: userError } = await supabase
    .from('users')
    .delete()
    .eq('uid', residentId)

  if (userError) throw userError
}

// Approve a resident's verification.
export async function verifyResidentUser(
  residentId: number | string,
) {
  const { error } = await supabase
    .from('users')
    .update({ is_verified: true })
    .eq('uid', residentId)

  if (error) throw error

  await updateVerificationDocumentsStatus(
    residentId,
    ['approved', 'Approved'],
  )
}

// Reject a resident's verification.
export async function rejectResidentUser(
  residentId: number | string,
  reason = 'Rejected by administrator',
) {
  const { error: userError } = await supabase
    .from('users')
    .update({ is_verified: false })
    .eq('uid', residentId)

  if (userError) throw userError

  await updateVerificationDocumentsStatus(
    residentId,
    ['rejected', 'Rejected'],
    reason,
  )
}

/**
 * Fetch dashboard data for one Admin's assigned sitio.
 *
 * IMPORTANT:
 * assignedSitioId must be the sitio_id from the Admin's profile.
 * Do not pass the Admin's uid as the sitio ID.
 */
export async function fetchDashboardDataFromSupabase(
  assignedSitioId: number | string,
): Promise<DashboardData> {
  const selectedSitioId = String(
    assignedSitioId ?? '',
  ).trim()

  // Do not load dashboard data if the Admin has no assigned sitio.
  if (!selectedSitioId) {
    throw new Error(
      'Admin has no assigned sitio. Dashboard data was not loaded.',
    )
  }

  // 1. Fetch residents assigned to this sitio only.
  const residentsResult = await supabase
    .from('residents')
    .select('*')
    .eq('sitio_id', selectedSitioId)

  if (residentsResult.error) {
    throw residentsResult.error
  }

  const residentsRows: AnyRow[] =
    residentsResult.data ?? []

  // Collect the IDs of residents belonging to this sitio.
  const residentIds = residentsRows
    .map((row) =>
      getField(row, ['uid', 'id', 'resident_uid']),
    )
    .filter(
      (id) => id !== null && id !== undefined,
    )
    .map(String)

  // 2. Fetch related data.
  // When there are no residents, use empty results for tables
  // whose records are linked to residents.
  const [
    usersResult,
    sitioResult,
    documentsResult,
    documentTypesResult,
    centersResult,
    recordsResult,
  ] = await Promise.all([
    residentIds.length > 0
      ? supabase
          .from('users')
          .select('*')
          .in('uid', residentIds)
      : Promise.resolve(EMPTY_ROWS_RESULT),

    supabase
      .from('sitios')
      .select('*')
      .eq('sitio_id', selectedSitioId),

    residentIds.length > 0
      ? supabase
          .from('verification_documents')
          .select('*')
          .in('uid', residentIds)
      : Promise.resolve(EMPTY_ROWS_RESULT),

    supabase
      .from('document_types')
      .select('*'),

    supabase
      .from('evacuation_centers')
      .select('*'),

    residentIds.length > 0
      ? supabase
          .from('evacuation_records')
          .select('*')
          .in('resident_uid', residentIds)
      : Promise.resolve(EMPTY_ROWS_RESULT),
  ])

  // Do not silently treat database errors as empty data.
  if (usersResult.error) throw usersResult.error
  if (sitioResult.error) throw sitioResult.error
  if (documentsResult.error) throw documentsResult.error
  if (documentTypesResult.error) {
    throw documentTypesResult.error
  }
  if (centersResult.error) throw centersResult.error
  if (recordsResult.error) throw recordsResult.error

  const usersRows: AnyRow[] =
    usersResult.data ?? []

  const sitiosRows: AnyRow[] =
    sitioResult.data ?? []

  const documentRows: AnyRow[] =
    documentsResult.data ?? []

  const documentTypeRows: AnyRow[] =
    documentTypesResult.data ?? []

  const centerRows: AnyRow[] =
    centersResult.data ?? []

  const recordRows: AnyRow[] =
    recordsResult.data ?? []

  // 3. Build lookup maps for efficient mapping.
  const usersByUid = toMap(
    usersRows,
    ['uid', 'id', 'user_id'],
  )

  const sitiosById = toMap(
    sitiosRows,
    ['sitio_id', 'id'],
  )

  const centersById = toMap(
    centerRows,
    ['center_id', 'id'],
  )

  const documentTypesById = toMap(
    documentTypeRows,
    ['type_id', 'id'],
  )

  const documentsByResidentId =
    groupDocumentsByResidentId(
      documentRows,
      documentTypesById,
    )

  // 4. Map residents.
  const residents = residentsRows.map(
    (residentRow, index) =>
      mapResident(
        residentRow,
        usersByUid,
        sitiosById,
        documentsByResidentId,
        index,
      ),
  )

  if (residentIds.length > 0) {
    const { data: disabilityRows, error: disabilityError } = await supabase
      .from('resident_disabilities').select('resident_uid,disability_id').in('resident_uid', residentIds)
    if (disabilityError) throw disabilityError
    const counts = new Map<string, Set<number>>()
    for (const row of disabilityRows ?? []) {
      const key = String(row.resident_uid)
      const ids = counts.get(key) ?? new Set<number>()
      ids.add(row.disability_id)
      counts.set(key, ids)
    }
    for (const resident of residents) resident.disabilityCount = counts.get(String(resident.id))?.size
    // Disability names (Visual, Hearing, …) for equipment matching (Module 5.4).
    if ((disabilityRows ?? []).length) {
      const { data: typeRows } = await supabase.from('disability_types').select('disability_id,disability_name')
      const names = new Map((typeRows ?? []).map((t) => [t.disability_id, t.disability_name as string]))
      for (const resident of residents) {
        const ids = counts.get(String(resident.id))
        if (ids) resident.disabilityTypes = [...ids].map((id) => names.get(id) ?? `Type ${id}`)
      }
    }
    const { data: details, error } = await supabase.from('resident_profile_details')
      .select('resident_uid,address,landmark,is_pregnant,vulnerability_needs,household_id')
      .in('resident_uid', residentIds)
    // Older deployments may not yet have the new table. Other errors must surface.
    if (error && !['PGRST205', '42P01'].includes(error.code)) throw error
    const householdResult = await supabase.from('households')
      .select('household_id,household_name,head_uid,household_members').eq('sitio_id', selectedSitioId)
    if (householdResult.error && !['PGRST205', '42P01'].includes(householdResult.error.code)) throw householdResult.error
    for (const detail of details ?? []) {
      const resident = residents.find((item) => String(item.id) === String(detail.resident_uid))
      if (resident) {
        resident.address = detail.address || resident.address
        resident.landmark = detail.landmark || 'No landmark provided'
        resident.isPregnant = detail.is_pregnant
        resident.disabilityCount ??= 0 // A saved assessment with no selected categories.
        resident.disabilityTypes ??= []
        resident.vulnerabilityNeeds = detail.vulnerability_needs
        const household = householdResult.data?.find((item) => item.household_id === detail.household_id)
        resident.householdId = household?.household_id
        resident.householdName = household?.household_name
        resident.householdMembers = household?.household_members
      }
    }
    // Household heads may have no profile-details row; link them through households.head_uid.
    for (const household of householdResult.data ?? []) {
      const head = residents.find((item) => String(item.id) === String(household.head_uid))
      if (!head) continue
      head.isHouseholdHead = true
      if (!head.householdId) {
        head.householdId = household.household_id
        head.householdName = household.household_name
        head.householdMembers = household.household_members
      }
    }
  }

  // 5. Map evacuation centers.
  // Occupancy is based on the records fetched for this Admin's
  // residents, not all residents in the system.
  const evacuationCenters = centerRows.map(
    (centerRow, index) =>
      mapEvacuationCenter(
        centerRow,
        recordRows,
        residentsRows,
        usersByUid,
        sitiosById,
        index,
      ),
  )

  const { data: facilityCatalog, error: facilityCatalogError } = await supabase.rpc('get_evacuation_facility_catalog')
  if (facilityCatalogError && facilityCatalogError.code !== 'PGRST202') throw facilityCatalogError
  for (const entry of (facilityCatalog ?? []) as { center_id: number; capacity: number | null; occupied: number; status?: string; closed_at?: string | null; closure_reason?: string | null }[]) {
    const center = evacuationCenters.find((item) => String(item.id) === String(entry.center_id))
    if (center) {
      center.capacity = entry.capacity ?? 0
      center.capacityConfirmed = entry.capacity !== null
      center.occupied = entry.occupied
      center.occupancyKnown = true
      center.status = entry.status ?? center.status
      center.closedAt = entry.closed_at
      center.closureReason = entry.closure_reason
    }
  }

  // 6. Map evacuation history.
  const evacuationHistory = recordRows.map(
    (recordRow, index) =>
      mapEvacuationHistory(
        recordRow,
        usersByUid,
        sitiosById,
        centersById,
        residentsRows,
        index,
      ),
  )

  // 7. Calculate dashboard alerts using this sitio's data.
  const pendingDocuments = documentRows.filter(
    (row) => {
      const status = String(
        getField(row, [
          'review_status',
          'status',
        ]) ?? '',
      ).toLowerCase()

      return status === 'pending'
    },
  ).length

  const mappedResidents = residents.filter(
    (resident) => resident.floodZone,
  ).length

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

// Update a resident's verification documents.
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
      updatePayload.rejection_reason =
        rejectionReason
    }

    const { error } = await supabase
      .from('verification_documents')
      .update(updatePayload)
      .eq('uid', residentId)

    if (!error) {
      return
    }

    console.warn(
      `Unable to update document status to ${status}:`,
      error,
    )
  }
}

// Map one resident database row into the dashboard format.
function mapResident(
  residentRow: AnyRow,
  usersByUid: Map<string, AnyRow>,
  sitiosById: Map<string, AnyRow>,
  documentsByResidentId: Map<
    string,
    VerificationDocument[]
  >,
  index: number,
): Resident {
  const uid = toScalar(getField(
    residentRow,
    ['uid', 'id', 'resident_uid'],
  ))

  const user = usersByUid.get(String(uid))

  const sitioId = getField(
    residentRow,
    ['sitio_id', 'sitioId'],
  )

  const sitio = sitiosById.get(String(sitioId))

  const firstName = getField(
    user,
    ['f_name', 'first_name', 'firstname'],
  )

  const middleName = getField(
    user,
    ['m_name', 'middle_name', 'middlename'],
  )

  const lastName = getField(
    user,
    ['l_name', 'last_name', 'lastname'],
  )

  const fullNameFromUser = [
    firstName,
    middleName,
    lastName,
  ]
    .filter(Boolean)
    .join(' ')
    .trim()

  const rowName = getField(
    residentRow,
    ['full_name', 'name', 'resident_name'],
  )

  const mobility = String(
    getField(residentRow, [
      'mobility_status',
      'constraint',
      'disability_type',
    ]) ?? '',
  )

  const latitude = toScalar(getField(
    residentRow,
    ['GPS_Lat', 'gps_lat', 'latitude', 'lat'],
  ))

  const longitude = toScalar(getField(
    residentRow,
    [
      'GPS_Long',
      'gps_long',
      'longitude',
      'lng',
      'long',
    ],
  ))

  const isVerified =
    getField(user, ['is_verified', 'verified']) ??
    getField(residentRow, [
      'is_verified',
      'verified',
    ])

  const verificationStatus = String(
    getField(residentRow, [
      'verification_status',
      'status',
    ]) ?? '',
  ).toLowerCase()

  const documents =
    documentsByResidentId.get(String(uid)) ?? []

  const hasRejectedDocument = documents.some(
    (document) =>
      document.reviewStatus === 'Rejected',
  )

  return {
    id: uid ?? `resident-${index + 1}`,

    name:
      fullNameFromUser ||
      String(rowName ?? `Resident ${index + 1}`),

    sitio: String(
      getField(sitio, ['sitio_name', 'name']) ??
        getField(residentRow, [
          'sitio',
          'sitio_name',
        ]) ??
        'Unknown Sitio',
    ),

    constraint: mapConstraint(mobility),
    mobilityStatus: mobility,

    status:
      Boolean(Number(isVerified)) ||
      verificationStatus === 'verified'
        ? 'Verified'
        : hasRejectedDocument ||
            verificationStatus === 'rejected'
          ? 'Rejected'
          : 'Pending',

    floodZone:
      latitude !== null &&
      latitude !== undefined &&
      longitude !== null &&
      longitude !== undefined,

    lastUpdated: formatDate(
      getField(residentRow, [
        'last_heartbeat',
        'updated_at',
        'created_at',
      ]),
    ),

    sex: String(
      getField(residentRow, ['sex', 'gender']) ??
        'Not specified',
    ),

    birthdate: String(
      getField(residentRow, [
        'birthdate',
        'birth_date',
        'birthday',
      ]) ?? '',
    ),

    address: String(
      getField(residentRow, [
        'address',
        'physical_address',
        'household_address',
        'home_address',
      ]) ??
        getField(sitio, [
          'sitio_name',
          'name',
        ]) ??
        'No address provided',
    ),

    landmark: String(
      getField(residentRow, [
        'landmark',
        'remarks',
        'location_note',
      ]) ?? 'No landmark provided',
    ),

    emergencyContactName: String(
      getField(residentRow, [
        'emerg_contact_name',
        'emergency_contact_name',
      ]) ?? 'Not provided',
    ),

    emergencyContactNo: String(
      getField(residentRow, [
        'emerg_contact_no',
        'emergency_contact_no',
      ]) ?? 'Not provided',
    ),

    gpsLat: latitude ?? null,
    gpsLong: longitude ?? null,
    documents,
  }
}

// Group documents by the resident they belong to.
function groupDocumentsByResidentId(
  rows: AnyRow[],
  documentTypesById: Map<string, AnyRow>,
): Map<string, VerificationDocument[]> {
  const grouped = new Map<
    string,
    VerificationDocument[]
  >()

  rows.forEach((row, index) => {
    const residentId = toScalar(getField(row, [
      'uid',
      'resident_uid',
      'user_id',
    ]))

    const typeId = getField(row, [
      'type_id',
      'document_type_id',
    ])

    const typeRow =
      documentTypesById.get(String(typeId))

    const reviewStatus = mapReviewStatus(
      String(
        getField(row, [
          'review_status',
          'status',
        ]) ?? 'Pending',
      ),
    )

    if (
      residentId === null ||
      residentId === undefined
    ) {
      return
    }

    const document: VerificationDocument = {
      id:
        toScalar(getField(row, ['doc_id', 'id'])) ??
        `document-${index + 1}`,

      residentId,

      typeName: String(
        getField(typeRow, [
          'type_name',
          'name',
        ]) ??
          getField(row, [
            'document_type',
            'type_name',
          ]) ??
          'Submitted ID',
      ),

      fileUrl: String(
        getField(row, [
          'file_url',
          'document_url',
          'url',
          'file_path',
        ]) ?? '',
      ),

      reviewStatus,

      uploadedAt: formatDate(
        getField(row, [
          'uploaded_at',
          'created_at',
        ]),
      ),

      rejectionReason:
        toOptionalText(getField(row, [
          'rejection_reason',
          'remarks',
        ])) ?? null,
    }

    const key = String(residentId)

    grouped.set(key, [
      ...(grouped.get(key) ?? []),
      document,
    ])
  })

  return grouped
}

function mapReviewStatus(
  value: string,
): VerificationDocument['reviewStatus'] {
  const normalized = value.toLowerCase()

  if (normalized.includes('approved')) {
    return 'Approved'
  }

  if (normalized.includes('rejected')) {
    return 'Rejected'
  }

  return 'Pending'
}

// Map an evacuation center and its assigned residents.
function mapEvacuationCenter(
  centerRow: AnyRow,
  recordRows: AnyRow[],
  residentRows: AnyRow[],
  usersByUid: Map<string, AnyRow>,
  sitiosById: Map<string, AnyRow>,
  index: number,
): EvacuationCenter {
  const centerId = toScalar(getField(
    centerRow,
    ['center_id', 'id'],
  ))

  const assignedRecords = recordRows.filter(
    (record) => {
      const recordCenterId = getField(
        record,
        ['evac_center_id', 'center_id'],
      )

      return (
        String(recordCenterId) ===
        String(centerId)
      )
    },
  )

  const assignedResidents = assignedRecords.map(
    (record, recordIndex) => {
      const residentUid = toScalar(getField(
        record,
        ['resident_uid', 'uid'],
      ))

      const resident = residentRows.find(
        (row) =>
          String(
            getField(row, ['uid', 'id']),
          ) === String(residentUid),
      )

      const user = usersByUid.get(
        String(residentUid),
      )

      const sitio = sitiosById.get(
        String(
          getField(resident, [
            'sitio_id',
            'sitioId',
          ]),
        ),
      )

      const firstName = getField(
        user,
        ['f_name', 'first_name', 'firstname'],
      )

      const middleName = getField(
        user,
        ['m_name', 'middle_name', 'middlename'],
      )

      const lastName = getField(
        user,
        ['l_name', 'last_name', 'lastname'],
      )

      const fullName = [
        firstName,
        middleName,
        lastName,
      ]
        .filter(Boolean)
        .join(' ')
        .trim()

      return {
        id:
          residentUid ??
          `center-resident-${index + 1}-${recordIndex + 1}`,

        name:
          fullName ||
          `Resident ${residentUid ?? recordIndex + 1}`,

        sitio: String(
          getField(sitio, [
            'sitio_name',
            'name',
          ]) ??
            getField(resident, [
              'sitio',
              'sitio_name',
            ]) ??
            'Unknown Sitio',
        ),

        constraint: mapConstraint(
          String(
            getField(resident, [
              'mobility_status',
              'constraint',
              'disability_type',
            ]) ?? '',
          ),
        ),

        evacuationStatus: String(
          getField(record, [
            'evac_status',
            'status',
          ]) ?? 'pending',
        ),
      }
    },
  )

  return {
    id: centerId ?? `center-${index + 1}`,

    name: String(
      getField(centerRow, [
        'center_name',
        'name',
      ]) ?? `Evacuation Center ${index + 1}`,
    ),

    capacity: Number(
      getField(centerRow, [
        'capacity',
        'max_capacity',
      ]) ?? 0,
    ),

    occupied: assignedResidents.length,
    capacityConfirmed: Number(centerRow.capacity) > 0,
    occupancyKnown: false,
    closedAt: toOptionalText(centerRow.closed_at),
    closureReason: toOptionalText(centerRow.closure_reason),
    facilityType: toOptionalText(centerRow.center_type) ?? undefined,
    gpsLat: Number(centerRow.gps_lat),
    gpsLong: Number(centerRow.gps_long),

    status: String(
      getField(centerRow, [
        'status',
        'center_status',
      ]) ?? 'Open',
    ),

    residents: assignedResidents,
  }
}

// Map an evacuation history record.
function mapEvacuationHistory(
  recordRow: AnyRow,
  usersByUid: Map<string, AnyRow>,
  sitiosById: Map<string, AnyRow>,
  centersById: Map<string, AnyRow>,
  residentRows: AnyRow[],
  index: number,
): EvacuationHistoryRecord {
  const residentUid = toScalar(getField(
    recordRow,
    ['resident_uid', 'uid'],
  ))

  const resident = residentRows.find(
    (row) =>
      String(getField(row, ['uid', 'id'])) ===
      String(residentUid),
  )

  const user = usersByUid.get(
    String(residentUid),
  )

  const sitio = sitiosById.get(
    String(
      getField(resident, [
        'sitio_id',
        'sitioId',
      ]),
    ),
  )

  const center = centersById.get(
    String(
      getField(recordRow, [
        'evac_center_id',
        'center_id',
      ]),
    ),
  )

  const firstName = getField(
    user,
    ['f_name', 'first_name', 'firstname'],
  )

  const middleName = getField(
    user,
    ['m_name', 'middle_name', 'middlename'],
  )

  const lastName = getField(
    user,
    ['l_name', 'last_name', 'lastname'],
  )

  const residentName = [
    firstName,
    middleName,
    lastName,
  ]
    .filter(Boolean)
    .join(' ')
    .trim()

  const loggedAt = getField(
    recordRow,
    ['logged_at', 'created_at'],
  )

  const evacuatedAt = getField(
    recordRow,
    ['evacuated_at', 'updated_at'],
  )

  const responseMinutes = getResponseMinutes(
    loggedAt,
    evacuatedAt,
  )

  const latitude = getField(
    resident,
    ['GPS_Lat', 'gps_lat', 'latitude', 'lat'],
  )

  const longitude = getField(
    resident,
    [
      'GPS_Long',
      'gps_long',
      'longitude',
      'lng',
      'long',
    ],
  )

  return {
    id:
      toScalar(getField(recordRow, [
        'record_id',
        'id',
      ])) ?? `evacuation-record-${index + 1}`,

    residentName:
      residentName ||
      `Resident ${residentUid ?? index + 1}`,

    sitio: String(
      getField(sitio, [
        'sitio_name',
        'name',
      ]) ??
        getField(resident, [
          'sitio',
          'sitio_name',
        ]) ??
        'Unknown Sitio',
    ),

    constraint: mapConstraint(
      String(
        getField(resident, [
          'mobility_status',
          'constraint',
          'disability_type',
        ]) ?? '',
      ),
    ),

    status: mapEvacuationStatus(
      String(
        getField(recordRow, [
          'evac_status',
          'status',
        ]) ?? 'Pending',
      ),
    ),

    evacuationCenter: String(
      getField(center, [
        'center_name',
        'name',
      ]) ?? 'Unassigned',
    ),

    disasterEvent: String(
      getField(recordRow, [
        'disaster_event',
        'event_name',
      ]) ?? 'Recorded Disaster Event',
    ),

    month: getMonthName(loggedAt),
    year: getYear(loggedAt),
    responseMinutes,

    floodZone:
      latitude !== null &&
      latitude !== undefined &&
      longitude !== null &&
      longitude !== undefined,
  }
}

// Create a map using one of the available keys.
function toMap(
  rows: AnyRow[],
  keys: string[],
) {
  const map = new Map<string, AnyRow>()

  rows.forEach((row) => {
    const key = getField(row, keys)

    if (
      key !== null &&
      key !== undefined
    ) {
      map.set(String(key), row)
    }
  })

  return map
}

// Narrow a raw identifier or coordinate to the string | number the UI uses.
// Strings and numbers pass through unchanged; null/undefined become undefined.
function toScalar(value: unknown): string | number | undefined {
  if (typeof value === 'string' || typeof value === 'number') return value
  if (value === null || value === undefined) return undefined
  return String(value)
}

// Narrow a raw optional text column, keeping null vs undefined as-is.
function toOptionalText(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return value
  return typeof value === 'string' ? value : String(value)
}

// Read the first available field from a database row.
function getField(
  row: AnyRow | undefined,
  keys: string[],
) {
  if (!row) return undefined

  for (const key of keys) {
    if (row[key] !== undefined) {
      return row[key]
    }
  }

  return undefined
}

function mapConstraint(
  value: string,
): Resident['constraint'] {
  const normalized = value.toLowerCase()

  if (normalized.includes('bed')) {
    return 'Bedridden'
  }

  if (normalized.includes('wheel')) {
    return 'Wheelchair'
  }

  if (normalized.includes('visual')) {
    return 'Visual'
  }

  return 'Walk Assist'
}

function mapEvacuationStatus(
  value: string,
): EvacuationHistoryRecord['status'] {
  const normalized = value.toLowerCase()

  if (
    normalized.includes('safe') ||
    normalized.includes('evacuated')
  ) {
    return 'Safely Evacuated'
  }

  if (
    normalized.includes('missing') ||
    normalized.includes('relocated') ||
    normalized.includes('failed')
  ) {
    return 'Missing / Relocated'
  }

  if (
    normalized.includes('transit') ||
    normalized.includes('extracted')
  ) {
    return 'In Transit'
  }

  return 'Pending'
}

function formatDate(value: unknown) {
  if (!value) return 'No update'

  const date = new Date(String(value))

  if (Number.isNaN(date.getTime())) {
    return String(value)
  }

  return date.toLocaleDateString(
    undefined,
    {
      month: 'short',
      day: 'numeric',
    },
  )
}

function getMonthName(value: unknown) {
  const date = value
    ? new Date(String(value))
    : new Date()

  if (Number.isNaN(date.getTime())) {
    return 'Unknown'
  }

  return date.toLocaleString(
    undefined,
    { month: 'long' },
  )
}

function getYear(value: unknown) {
  const date = value
    ? new Date(String(value))
    : new Date()

  if (Number.isNaN(date.getTime())) {
    return new Date().getFullYear()
  }

  return date.getFullYear()
}

function getResponseMinutes(
  start: unknown,
  end: unknown,
) {
  if (!start || !end) return 0

  const startDate = new Date(String(start))
  const endDate = new Date(String(end))

  if (
    Number.isNaN(startDate.getTime()) ||
    Number.isNaN(endDate.getTime())
  ) {
    return 0
  }

  return Math.max(
    0,
    Math.round(
      (endDate.getTime() - startDate.getTime()) /
        60000,
    ),
  )
}
