import type React from 'react'
import { useEffect } from 'react'
import type { AccountAction, AccountFilter, Resident, Status } from '../types/dashboard'
import { residentVpi } from '../utils/householdVpi'
import { VPI_LABELS } from '../utils/vpi'

type ResidentTableProps = {
  title: string
  residents: Resident[]
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
  ['All', 'Everyone'], ['Pending', 'Needs review'], ['Verified', 'Verified'], ['Rejected', 'Rejected'],
]

export function ResidentTable({
  title,
  residents,
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

  // Clicking anywhere else closes an open "More" menu.
  useEffect(() => {
    const close = (e: MouseEvent) => {
      document.querySelectorAll('details.row-more[open]').forEach((d) => {
        if (!d.contains(e.target as Node)) d.removeAttribute('open')
      })
    }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [])

  return (
    <section className="panel table-panel">
      <div className="section-header">
        <div>{title && <h3>{title}</h3>}<span>{residents.length} {residents.length === 1 ? 'resident' : 'residents'} shown</span></div>
        {headerAction}
      </div>

      <div className="table-actions resident-status-chips" role="group" aria-label="Filter by status">
        {STATUS_CHIPS.map(([value, label]) => (
          <button key={value} type="button" aria-pressed={statusFilter === value}
            className={statusFilter === value ? 'verify-button' : 'secondary-button'}
            onClick={() => onStatusFilterChange(value)}>{label}</button>
        ))}
      </div>

      <div className="filters">
        <input
          type="search"
          value={searchTerm}
          placeholder="Search name, barangay or need…"
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
              <th>Needs</th>
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
                  <tr key={resident.id}>
                    <td><strong>{resident.name}</strong>
                      {resident.householdName && <div className="resident-sub">{resident.householdName}</div>}</td>
                    <td>{resident.barangay}</td>
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
                          {onViewResidentRequest && (resident.status === 'Pending' ? (
                            <button className="review-button" onClick={() => onViewResidentRequest(resident)}>Review ID</button>
                          ) : (
                            <button className="view-request-button" onClick={() => onViewResidentRequest(resident)}>Details</button>
                          ))}
                          {(onEditResident || onResetPin || onChangeAccountState) && (
                            <details className="row-more">
                              <summary aria-label={`More actions for ${resident.name}`}>More ▾</summary>
                              <div className="row-more-menu">
                                {onEditResident && (
                                  <button onClick={(e) => { closeMenu(e); onEditResident(resident) }}>Edit details</button>
                                )}
                                {onResetPin && accountState !== 'Archived' && (
                                  <button title="Forgot PIN: set a new one after checking their ID" onClick={(e) => { closeMenu(e); onResetPin(resident) }}>Reset PIN</button>
                                )}
                                {/* Account: Active -> Deactivate. Deactivated -> Reactivate or Archive. Archived -> Restore.
                                    Residents are never deleted; their records stay for the audit trail. */}
                                {onChangeAccountState && accountState === 'Active' && (
                                  <button className="danger" onClick={(e) => { closeMenu(e); onChangeAccountState(resident, 'deactivate') }}>Deactivate account</button>
                                )}
                                {onChangeAccountState && accountState === 'Deactivated' && <>
                                  <button onClick={(e) => { closeMenu(e); onChangeAccountState(resident, 'reactivate') }}>Reactivate</button>
                                  <button className="danger" onClick={(e) => { closeMenu(e); onChangeAccountState(resident, 'archive') }}>Archive</button>
                                </>}
                                {onChangeAccountState && accountState === 'Archived' && (
                                  <button onClick={(e) => { closeMenu(e); onChangeAccountState(resident, 'restore') }}>Restore</button>
                                )}
                              </div>
                            </details>
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



// Closes the row's "More" menu after a choice.
function closeMenu(e: { currentTarget: HTMLElement }) {
  e.currentTarget.closest('details')?.removeAttribute('open')
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
