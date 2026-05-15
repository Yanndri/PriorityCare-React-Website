import type { Resident, Status } from '../types/dashboard'
import Select from 'react-select'

type ResidentTableProps = {
  title: string
  residents: Resident[]
  searchTerm: string
  statusFilter: 'All' | Status
  onSearchChange: (value: string) => void
  onStatusFilterChange: (value: 'All' | Status) => void
  onViewResidentRequest?: (resident: Resident) => void
  onEditResident?: (resident: Resident) => void
  onDeleteResident?: (resident: Resident) => void
  onVerifyResident?: (residentId: number | string) => void
  verifyingResidentId?: number | string | null
}

export function ResidentTable({
  title,
  residents,
  searchTerm,
  statusFilter,
  onSearchChange,
  onStatusFilterChange,
  onViewResidentRequest,
  onEditResident,
  onDeleteResident,
  onVerifyResident,
  verifyingResidentId,
}: ResidentTableProps) {
  const hasActions = Boolean(onViewResidentRequest || onEditResident || onDeleteResident || onVerifyResident)

  return (
    <section className="panel table-panel">
      <div className="section-header">
        <h3>{title}</h3>
        <span>{residents.length} shown</span>
      </div>

      {/* Search and filter controls update state stored in App.tsx. */}
      <div className="filters">
        <Select
          isClearable
          value={
            searchTerm
              ? { value: searchTerm, label: searchTerm }
              : { value: '', label: 'All Locations' }
          }
          options={[
            { value: '', label: 'All Locations' },
            { value: 'San Roque', label: 'Brgy. San Roque' },
            { value: 'Mabolo', label: 'Brgy. Mabolo' },
            { value: 'Lahug', label: 'Brgy. Lahug' },
            { value: 'Sitio Pag-asa', label: 'Sitio Pag-asa' },
            { value: 'Sitio Maligaya', label: 'Sitio Maligaya' },
            { value: 'Sitio Rizal', label: 'Sitio Rizal' },
            { value: 'Sitio Mabuhay', label: 'Sitio Mabuhay' },
          ]}
          placeholder="Search location..."
          onChange={(selected) => {
            onSearchChange(selected?.value || '')
          }}
        />

        <select
          value={statusFilter}
          onChange={(event) => onStatusFilterChange(event.target.value as 'All' | Status)}
        >
          <option value="All">All Statuses</option>
          <option value="Pending">Pending</option>
          <option value="Verified">Verified</option>
          <option value="Rejected">Rejected</option>
        </select>
      </div>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Sitio</th>
              <th>Constraint</th>
              <th>Status</th>
              {hasActions && <th>Action</th>}
            </tr>
          </thead>

          <tbody>
            {residents.length === 0 ? (
              <tr>
                <td colSpan={hasActions ? 5 : 4}>No residents found.</td>
              </tr>
            ) : (
              residents.map((resident) => {
                const isVerifying = verifyingResidentId === resident.id

                return (
                  <tr key={resident.id}>
                    <td>{resident.name}</td>
                    <td>{resident.sitio}</td>
                    <td>
                      <span className={`badge ${getConstraintClassName(resident.constraint)}`}>
                        {resident.constraint}
                      </span>
                    </td>
                    <td>
                      <span className={`status ${resident.status.toLowerCase()}`}>
                        {resident.status}
                      </span>
                    </td>

                    {hasActions && (
                      <td>
                        <div className="table-actions">
                          {onViewResidentRequest && (
                            <button
                              className="view-request-button"
                              onClick={() => onViewResidentRequest(resident)}
                            >
                              View Request
                            </button>
                          )}

                          {getPrimaryDocumentUrl(resident) && (
                            <button
                              className="view-id-button"
                              onClick={() => openSubmittedId(resident)}
                            >
                              View ID
                            </button>
                          )}

                          {onVerifyResident && resident.status === 'Pending' && (
                            <button
                              className="verify-button"
                              disabled={isVerifying}
                              onClick={() => onVerifyResident(resident.id)}
                            >
                              {isVerifying ? 'Verifying...' : 'Verify'}
                            </button>
                          )}

                          {onEditResident && (
                            <button className="edit-button" onClick={() => onEditResident(resident)}>
                              Edit
                            </button>
                          )}

                          {onDeleteResident && (
                            <button className="delete-button" onClick={() => onDeleteResident(resident)}>
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// Gets the first submitted verification document URL for the resident.
function getPrimaryDocumentUrl(resident: Resident) {
  return resident.documents?.find((document) => document.fileUrl)?.fileUrl
}

// Opens the submitted ID/document in a new browser tab.
function openSubmittedId(resident: Resident) {
  const fileUrl = getPrimaryDocumentUrl(resident)

  if (fileUrl) {
    window.open(fileUrl, '_blank', 'noopener,noreferrer')
  }
}

// Turns "Walk Assist" into "walk-assist" so CSS can style it.
function getConstraintClassName(constraint: Resident['constraint']) {
  return constraint.toLowerCase().replace(' ', '-')
}
