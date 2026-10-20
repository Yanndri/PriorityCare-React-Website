import type { AccountAction, AccountFilter, Resident, Status } from '../types/dashboard'
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
  onChangeAccountState?: (resident: Resident, action: AccountAction) => void
  accountFilter?: AccountFilter
  onAccountFilterChange?: (value: AccountFilter) => void
  verifyingResidentId?: number | string | null
  // Barangay names present in the loaded data (the location filter options).
  locationOptions?: string[]
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
  onChangeAccountState,
  accountFilter,
  onAccountFilterChange,
  verifyingResidentId,
  locationOptions = [],
}: ResidentTableProps) {
  const hasActions = Boolean(
    onViewResidentRequest || onEditResident || onDeleteResident || onVerifyResident || onChangeAccountState,
  )

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
          // Real barangay names from the loaded records (previously a fixed
          // list of sample locations that did not match the database).
          options={[
            { value: '', label: 'All Locations' },
            ...locationOptions.map((name) => ({ value: name, label: name })),
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

        {accountFilter && onAccountFilterChange && (
          <select
            aria-label="Account"
            value={accountFilter}
            onChange={(event) => onAccountFilterChange(event.target.value as AccountFilter)}
          >
            <option value="Current">Current Accounts</option>
            <option value="Active">Active</option>
            <option value="Deactivated">Deactivated</option>
            <option value="Archived">Archived</option>
            <option value="All">All Accounts</option>
          </select>
        )}
      </div>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Barangay</th>
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
                    <td>{resident.barangay}</td>
                    <td>
                      <span className={`badge ${getConstraintClassName(resident.constraint)}`}>
                        {resident.constraint}
                      </span>
                    </td>
                    <td>
                      <span className={`status ${resident.status.toLowerCase()}`}>
                        {resident.status}
                      </span>
                      {resident.accountState && resident.accountState !== 'Active' && (
                        <span
                          className={`status account-${resident.accountState.toLowerCase()}`}
                          title={describeAccountState(resident)}
                        >
                          {resident.accountState}
                        </span>
                      )}
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

                          {onChangeAccountState && resident.accountState === 'Archived' && (
                            <button className="account-button" onClick={() => onChangeAccountState(resident, 'restore')}>
                              Restore
                            </button>
                          )}

                          {onChangeAccountState && resident.accountState === 'Deactivated' && (
                            <button className="account-button" onClick={() => onChangeAccountState(resident, 'reactivate')}>
                              Reactivate
                            </button>
                          )}

                          {onChangeAccountState && (resident.accountState ?? 'Active') === 'Active' && (
                            <button className="account-button" onClick={() => onChangeAccountState(resident, 'deactivate')}>
                              Deactivate
                            </button>
                          )}

                          {onChangeAccountState && resident.accountState !== 'Archived' && (
                            <button className="account-button archive" onClick={() => onChangeAccountState(resident, 'archive')}>
                              Archive
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

// Hover text for a Deactivated / Archived tag: why and when.
function describeAccountState(resident: Resident) {
  const when = resident.statusChangedAt ? new Date(resident.statusChangedAt).toLocaleString() : null
  return [resident.statusReason, when].filter(Boolean).join(' · ') || resident.accountState || ''
}

// Turns "Walk Assist" into "walk-assist" so CSS can style it.
function getConstraintClassName(constraint: Resident['constraint']) {
  return constraint.toLowerCase().replace(' ', '-')
}
