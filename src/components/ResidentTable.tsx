import type React from 'react'
import type { AccountAction, AccountFilter, Resident, Status } from '../types/dashboard'
import { residentVpi } from '../utils/householdVpi'
import { VPI_LABELS } from '../utils/vpi'

type ResidentTableProps = {
  title: string
  residents: Resident[]
  // How many residents each status tab holds.
  statusCounts?: Record<'All' | Status, number>
  searchTerm: string
  statusFilter: 'All' | Status
  onSearchChange: (value: string) => void
  onStatusFilterChange: (value: 'All' | Status) => void
  onViewResidentRequest?: (resident: Resident) => void
  onEditResident?: (resident: Resident) => void
  onChangeAccountState?: (resident: Resident, action: AccountAction) => void
  // Forgot PIN: staff set a new one after checking the resident's ID.
  onResetPin?: (resident: Resident) => void
  accountFilter?: AccountFilter
  onAccountFilterChange?: (value: AccountFilter) => void
  // Shown at the right of the header, e.g. "Register resident".
  headerAction?: React.ReactNode
}

const STATUS_CHIPS: ['All' | Status, string][] = [
  ['Pending', 'Needs review'], ['Verified', 'Verified'], ['Rejected', 'Rejected'], ['All', 'Everyone'],
]

export function ResidentTable({
  title,
  residents,
  statusCounts,
  searchTerm,
  statusFilter,
  onSearchChange,
  onStatusFilterChange,
  onViewResidentRequest,
  onEditResident,
  onChangeAccountState,
  onResetPin,
  accountFilter,
  onAccountFilterChange,
  headerAction,
}: ResidentTableProps) {
  const hasActions = Boolean(
    onViewResidentRequest || onEditResident || onChangeAccountState || onResetPin,
  )

  return (
    <section className="panel table-panel">
      <div className="section-header">
        <div>{title && <h3>{title}</h3>}<span>{residents.length} {residents.length === 1 ? 'resident' : 'residents'} shown</span></div>
        {headerAction}
      </div>

      <div className="table-actions resident-status-chips" role="group" aria-label="Filter by status">
        {STATUS_CHIPS.map(([value, label]) => (
          <button key={value} type="button" aria-pressed={statusFilter === value}
            className={`status-tab${statusFilter === value ? ' is-on' : ''}${value === 'Pending' && statusCounts?.Pending ? ' has-waiting' : ''}`}
            onClick={() => onStatusFilterChange(value)}>{label}{statusCounts && <span className="status-tab-n">{statusCounts[value]}</span>}</button>
        ))}
      </div>

      <div className="filters">
        <input
          type="search"
          value={searchTerm}
          placeholder="Search name, household, barangay or sitio…"
          aria-label="Search residents"
          onChange={(event) => onSearchChange(event.target.value)}
        />
        {accountFilter && onAccountFilterChange && (
          <select
            aria-label="Account"
            value={accountFilter}
            onChange={(event) => onAccountFilterChange(event.target.value as AccountFilter)}
          >
            <option value="Current">Current accounts</option>
            <option value="Active">Active</option>
            <option value="Deactivated">Deactivated</option>
            <option value="Archived">Archived</option>
            <option value="All">All accounts</option>
          </select>
        )}
      </div>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Barangay</th>
              <th>Mobility</th>
              <th title="One score out of 100 for the whole household: mobility, pregnancy, children, seniors and house type. Critical 70+, Assisted 40+.">Priority (VPI)</th>
              <th>Status</th>
              {hasActions && <th>Actions</th>}
            </tr>
          </thead>

          <tbody>
            {residents.length === 0 ? (
              <tr>
                <td colSpan={hasActions ? 6 : 5}>No residents match.</td>
              </tr>
            ) : (
              residents.map((resident) => {
                const vpi = residentVpi(resident)
                const accountState = resident.accountState ?? 'Active'

                return (
                  <tr key={resident.id} className={onViewResidentRequest ? 'resident-row' : undefined}
                    onClick={onViewResidentRequest ? () => onViewResidentRequest(resident) : undefined}>
                    <td><strong>{resident.name}</strong>
                      {resident.householdName && <div className="resident-sub">{resident.householdName}</div>}</td>
                    <td>{resident.barangay}{resident.sitio && <div className="resident-sub">Sitio {resident.sitio}</div>}</td>
                    <td>
                      <span className={`badge ${getConstraintClassName(resident.constraint)}`}>
                        {resident.constraint}
                      </span>
                    </td>
                    <td>
                      <span className={`vpi-badge vpi-${vpi.priority === 'CRITICAL' ? 'high' : vpi.priority === 'ASSISTED' ? 'moderate' : 'low'}`}>
                        {VPI_LABELS[vpi.priority]} · {vpi.score}
                      </span>
                    </td>
                    <td>
                      <span className={`status ${resident.status.toLowerCase()}`}>
                        {resident.status === 'Pending' ? 'Needs review' : resident.status}
                      </span>
                      {accountState !== 'Active' && (
                        <span className={`status account-${accountState.toLowerCase()}`} title={describeAccountState(resident)}>
                          {accountState}
                        </span>
                      )}
                    </td>

                    {/* One button per row. Edit, Reset PIN and account changes are in the Details panel. */}
                    {hasActions && (
                      <td className="resident-row-action">
                        {onViewResidentRequest && (resident.status === 'Pending'
                          ? <button type="button" className="review-button" onClick={(e) => { e.stopPropagation(); onViewResidentRequest(resident) }}>Review ID</button>
                          : <button type="button" className="row-open" aria-label={`Open details for ${resident.name}`}
                              onClick={(e) => { e.stopPropagation(); onViewResidentRequest(resident) }}>›</button>)}
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



// Hover text for a Deactivated / Archived tag: why and when.
function describeAccountState(resident: Resident) {
  const when = resident.statusChangedAt ? new Date(resident.statusChangedAt).toLocaleString() : null
  return [resident.statusReason, when].filter(Boolean).join(' · ') || resident.accountState || ''
}

// Turns "Needs help walking" into "needs-help-walking" so CSS can style it.
function getConstraintClassName(constraint: Resident['constraint']) {
  return constraint.toLowerCase().replace(/\s+/g, '-')
}
