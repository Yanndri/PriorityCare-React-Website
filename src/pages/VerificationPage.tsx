import { useState } from 'react'
import type { AccountAction, AccountFilter, Resident, Status, VerificationDocument } from '../types/dashboard'
import { ResidentTable } from '../components/ResidentTable'
import { SidePanel } from '../components/SidePanel'
import { useShowOnMap } from '../lib/showOnMap'
import { equipmentDataGaps, matchEquipment } from '../utils/equipmentMatch'

type VerificationPageProps = {
  residents: Resident[]
  statusCounts?: Record<'All' | Status, number>
  searchTerm: string
  statusFilter: 'All' | Status
  verifyingResidentId: number | string | null
  onSearchChange: (value: string) => void
  onStatusFilterChange: (value: 'All' | Status) => void
  onVerifyResident: (residentId: number | string) => void
  onRejectResident: (residentId: number | string, reason: string) => void
  onEditResident: (resident: Resident) => void
  onChangeAccountState: (resident: Resident, action: AccountAction) => void
  onResetPin?: (resident: Resident) => void
  accountFilter: AccountFilter
  onAccountFilterChange: (value: AccountFilter) => void
  onRegisterResident?: () => void
}

export function VerificationPage({
  residents,
  statusCounts,
  searchTerm,
  statusFilter,
  verifyingResidentId,
  onSearchChange,
  onStatusFilterChange,
  onVerifyResident,
  onRejectResident,
  onEditResident,
  onChangeAccountState,
  onResetPin,
  accountFilter,
  onAccountFilterChange,
  onRegisterResident,
}: VerificationPageProps) {
  const [selectedResident, setSelectedResident] = useState<Resident | null>(null)

  const selectedResidentFromLatestData =
    residents.find((resident) => resident.id === selectedResident?.id) ?? selectedResident

  return (
    <>
      <ResidentTable
        title=""
        headerAction={onRegisterResident && (
          <button type="button" className="verify-button" onClick={onRegisterResident}>Register resident</button>
        )}
        residents={residents}
        statusCounts={statusCounts}
        searchTerm={searchTerm}
        statusFilter={statusFilter}
        onSearchChange={onSearchChange}
        onStatusFilterChange={onStatusFilterChange}
        onViewResidentRequest={setSelectedResident}
        onEditResident={onEditResident}
        onChangeAccountState={onChangeAccountState}
        onResetPin={onResetPin}
        accountFilter={accountFilter}
        onAccountFilterChange={onAccountFilterChange}
      />

      {selectedResidentFromLatestData && (
        <VerificationRequestModal
          resident={selectedResidentFromLatestData}
          isProcessing={verifyingResidentId === selectedResidentFromLatestData.id}
          onClose={() => setSelectedResident(null)}
          onVerify={() => onVerifyResident(selectedResidentFromLatestData.id)}
          onReject={(reason) => onRejectResident(selectedResidentFromLatestData.id, reason)}
          onEdit={() => { const r = selectedResidentFromLatestData; setSelectedResident(null); onEditResident(r) }}
          onResetPin={onResetPin ? () => onResetPin(selectedResidentFromLatestData) : undefined}
          onAccount={(action) => onChangeAccountState(selectedResidentFromLatestData, action)}
        />
      )}
    </>
  )
}

type VerificationRequestModalProps = {
  resident: Resident
  isProcessing: boolean
  onClose: () => void
  onVerify: () => void
  onReject: (reason: string) => void
  onEdit: () => void
  onResetPin?: () => void
  onAccount: (action: AccountAction) => void
}

function ageFrom(birthdate?: string) {
  if (!birthdate) return null
  const b = new Date(birthdate)
  if (Number.isNaN(b.getTime())) return null
  const now = new Date()
  let age = now.getFullYear() - b.getFullYear()
  if (now.getMonth() < b.getMonth() || (now.getMonth() === b.getMonth() && now.getDate() < b.getDate())) age -= 1
  return age >= 0 ? age : null
}

// Resident details in the right side panel: who they are, where to find them, what a rescue needs,
// their household and ID. The buttons at the bottom depend on the verification status.
function VerificationRequestModal({
  resident,
  isProcessing,
  onClose,
  onVerify,
  onReject,
  onEdit,
  onResetPin,
  onAccount,
}: VerificationRequestModalProps) {
  const documents = resident.documents ?? []
  const [showRejectPopup, setShowRejectPopup] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const showOnMap = useShowOnMap()

  function handleSubmitReject() {
    const trimmedReason = rejectReason.trim()
    if (!trimmedReason) {
      window.alert('Please enter a note/reason before rejecting this request.')
      return
    }
    onReject(trimmedReason)
    setShowRejectPopup(false)
    setRejectReason('')
  }

  const age = ageFrom(resident.birthdate)
  const hasGps = resident.gpsLat != null && resident.gpsLong != null && Number(resident.gpsLat) !== 0
  const needs = matchEquipment(resident)
  const gaps = equipmentDataGaps(resident)
  const rejection = documents.find((d) => d.rejectionReason)?.rejectionReason
  const members = resident.householdMembers ?? []
  const accountState = resident.accountState ?? 'Active'
  const contact = [resident.emergencyContactName, resident.emergencyContactNo].filter(Boolean).join(' · ')

  return (
    <SidePanel title="Resident details" busy={isProcessing} onClose={onClose}>
      <div className="rd">
        <header className="rd-head">
          <h4>{resident.name} <span className={`rd-status rd-${resident.status.toLowerCase()}`}>{resident.status}</span></h4>
          <p>
            {[resident.barangay, resident.householdName || 'No household',
              age !== null ? `${age} years old` : null, resident.sex].filter(Boolean).join(' · ')}
          </p>
        </header>

        <section className="rd-section">
          <h5>Where to find them</h5>
          <dl className="rd-facts">
            <dt>Address</dt><dd>{resident.address || resident.barangay}{resident.sitio ? ` · Sitio ${resident.sitio}` : ''}</dd>
            <dt>Landmark</dt><dd>{resident.landmark && resident.landmark !== 'No landmark provided' ? resident.landmark : 'None given'}</dd>
            <dt>Emergency contact</dt><dd>{contact || 'Not provided'}</dd>
            <dt>Home on the map</dt><dd>{hasGps && showOnMap
              ? <button type="button" className="secondary-button" onClick={() => {
                  showOnMap({ lat: Number(resident.gpsLat), lng: Number(resident.gpsLong), label: resident.name }); onClose()
                }}>See on map</button>
              : 'Not pinned yet'}</dd>
          </dl>
        </section>

        <section className="rd-section">
          <h5>Needs in a rescue</h5>
          <dl className="rd-facts">
            <dt>Mobility</dt><dd>{resident.mobilityStatus?.replaceAll('_', ' ') || resident.constraint || 'Not recorded'}</dd>
            <dt>Pregnant</dt><dd>{resident.isPregnant === undefined ? 'Not recorded' : resident.isPregnant ? 'Yes' : 'No'}</dd>
            <dt>Disabilities</dt><dd>{resident.disabilityTypes === undefined ? 'Not assessed' : resident.disabilityTypes.length ? resident.disabilityTypes.join(', ') : 'None'}</dd>
            <dt>Assistance needs</dt><dd>{resident.vulnerabilityNeeds || 'None recorded'}</dd>
            <dt>Bring</dt><dd>{needs.length
              ? <span className="rd-chips">{needs.map((n) => <span key={n.equipment} title={n.reasons.join('; ')}>{n.equipment}</span>)}</span>
              : 'Nothing special'}
              {gaps.length > 0 && <small className="rd-muted">Not yet known: {gaps.join(', ')}</small>}</dd>
          </dl>
        </section>

        <section className="rd-section">
          <h5>Household ({members.length + 1} {members.length ? 'people' : 'person'})</h5>
          {members.length
            ? <table className="rd-table">
                <thead><tr><th>Name</th><th>Relationship</th><th>Age</th></tr></thead>
                <tbody>{members.map((m, i) => {
                  const a = ageFrom(m.birthdate)
                  const notes = [m.is_pregnant ? 'Pregnant' : '', m.mobility && m.mobility !== 'ambulatory' ? m.mobility.replaceAll('_', ' ') : '', m.needs].filter(Boolean).join(' · ')
                  return <tr key={m.member_id ?? i}>
                    <td>{m.name}{notes && <small className="rd-muted">{notes}</small>}</td>
                    <td>{m.relationship}</td>
                    <td>{a ?? '—'}</td>
                  </tr>
                })}</tbody>
              </table>
            : <p className="rd-muted">Lives alone (no other members listed).</p>}
        </section>

        <section className="rd-section">
          <h5>ID</h5>
          {documents.length === 0
            ? <p className="rd-muted">No ID uploaded yet.</p>
            : <div className="document-list">{documents.map((document) => <DocumentPreview key={document.id} document={document} />)}</div>}
        </section>

        <footer className="rd-actions">
          {resident.status === 'Rejected' && rejection && <p className="rd-rejected">Rejected: {rejection}</p>}
          {accountState !== 'Active' && <p className="rd-rejected rd-account">Account {accountState.toLowerCase()}.</p>}
          {/* Account: Active -> Deactivate. Deactivated -> Reactivate or Archive. Archived -> Restore. Never deleted. */}
          {accountState === 'Active' && <button type="button" className="danger-button" disabled={isProcessing} onClick={() => onAccount('deactivate')}>Deactivate account</button>}
          {accountState === 'Deactivated' && <>
            <button type="button" className="danger-button" disabled={isProcessing} onClick={() => onAccount('archive')}>Archive</button>
            <button type="button" className="secondary-button" disabled={isProcessing} onClick={() => onAccount('reactivate')}>Reactivate</button>
          </>}
          {accountState === 'Archived' && <button type="button" className="secondary-button" disabled={isProcessing} onClick={() => onAccount('restore')}>Restore</button>}
          {onResetPin && accountState !== 'Archived' && <button type="button" className="secondary-button" disabled={isProcessing}
            title="Forgot PIN: set a new one after checking their ID" onClick={onResetPin}>Reset PIN</button>}
          <span className="rd-actions-gap" />
          <button type="button" className={resident.status === 'Verified' ? 'primary-button' : 'secondary-button'} disabled={isProcessing} onClick={onEdit}>Edit details</button>
          {resident.status === 'Pending' && <button type="button" className="danger-button" disabled={isProcessing}
            onClick={() => { setRejectReason(''); setShowRejectPopup(true) }}>Reject</button>}
          {resident.status !== 'Verified' && <button type="button" className="primary-button" disabled={isProcessing} onClick={onVerify}>
            {isProcessing ? 'Saving…' : 'Verify resident'}</button>}
        </footer>
      </div>

      {showRejectPopup && (
        <div className="reject-popup-backdrop">
          <section className="reject-popup-card">
            <h3>Reject verification</h3>
            <p>Tell the resident why. They see this reason and can send a new ID.</p>
            <textarea
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              placeholder="Example: The ID photo is blurry, or the address does not match."
              autoFocus
            />
            <div className="reject-popup-actions">
              <button type="button" className="secondary-button" onClick={() => setShowRejectPopup(false)}>Cancel</button>
              <button type="button" className="danger-button" disabled={isProcessing} onClick={handleSubmitReject}>
                {isProcessing ? 'Rejecting…' : 'Reject'}
              </button>
            </div>
          </section>
        </div>
      )}
    </SidePanel>
  )
}

type DocumentPreviewProps = {
  document: VerificationDocument
}

function DocumentPreview({ document }: DocumentPreviewProps) {
  const isImage = isImageUrl(document.fileUrl)

  return (
    <article className="document-card">
      <div>
        <strong>{document.typeName}</strong>
        <span>Status: {document.reviewStatus}</span>
        <small>Uploaded: {document.uploadedAt}</small>
      </div>

      {document.fileUrl ? (
        <>
          {isImage && (
            <img
              src={document.fileUrl}
              alt={`${document.typeName} preview`}
              onError={(event) => {
                event.currentTarget.style.display = 'none'
              }}
            />
          )}

          <a className="view-id-link" href={document.fileUrl} target="_blank" rel="noreferrer">
            View ID
          </a>
        </>
      ) : (
        <p>No file URL available.</p>
      )}

      {document.rejectionReason && (
        <p className="rejection-reason">Reason: {document.rejectionReason}</p>
      )}
    </article>
  )
}

function isImageUrl(url: string) {
  const lowerUrl = url.toLowerCase().split('?')[0]

  return (
    lowerUrl.endsWith('.png') ||
    lowerUrl.endsWith('.jpg') ||
    lowerUrl.endsWith('.jpeg') ||
    lowerUrl.endsWith('.webp') ||
    lowerUrl.includes('image')
  )
}
