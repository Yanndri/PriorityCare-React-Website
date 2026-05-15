import { useState } from 'react'
import type { Resident, Status, VerificationDocument } from '../types/dashboard'
import { ResidentTable } from '../components/ResidentTable'

type VerificationPageProps = {
  residents: Resident[]
  searchTerm: string
  statusFilter: 'All' | Status
  verifyingResidentId: number | string | null
  onSearchChange: (value: string) => void
  onStatusFilterChange: (value: 'All' | Status) => void
  onVerifyResident: (residentId: number | string) => void
  onRejectResident: (residentId: number | string, reason: string) => void
  onEditResident: (resident: Resident) => void
  onDeleteResident: (resident: Resident) => void
}

export function VerificationPage({
  residents,
  searchTerm,
  statusFilter,
  verifyingResidentId,
  onSearchChange,
  onStatusFilterChange,
  onVerifyResident,
  onRejectResident,
  onEditResident,
  onDeleteResident,
}: VerificationPageProps) {
  const [selectedResident, setSelectedResident] = useState<Resident | null>(null)

  const selectedResidentFromLatestData =
    residents.find((resident) => resident.id === selectedResident?.id) ?? selectedResident

  return (
    <>
      <ResidentTable
        title="Verification Queue"
        residents={residents}
        searchTerm={searchTerm}
        statusFilter={statusFilter}
        verifyingResidentId={verifyingResidentId}
        onSearchChange={onSearchChange}
        onStatusFilterChange={onStatusFilterChange}
        onViewResidentRequest={setSelectedResident}
        onVerifyResident={onVerifyResident}
        onEditResident={onEditResident}
        onDeleteResident={onDeleteResident}
      />

      {selectedResidentFromLatestData && (
        <VerificationRequestModal
          resident={selectedResidentFromLatestData}
          isProcessing={verifyingResidentId === selectedResidentFromLatestData.id}
          onClose={() => setSelectedResident(null)}
          onVerify={() => onVerifyResident(selectedResidentFromLatestData.id)}
          onReject={(reason) => onRejectResident(selectedResidentFromLatestData.id, reason)}
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
}

function VerificationRequestModal({
  resident,
  isProcessing,
  onClose,
  onVerify,
  onReject,
}: VerificationRequestModalProps) {
  const documents = resident.documents ?? []
  const [showRejectPopup, setShowRejectPopup] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

  function handleOpenRejectPopup() {
    setShowRejectPopup(true)
    setRejectReason('')
  }

  function handleCancelReject() {
    setShowRejectPopup(false)
    setRejectReason('')
  }

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

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <section className="request-modal">
        <div className="request-modal-header">
          <div>
            <h3>Resident Verification Request</h3>
            <p>Review the submitted ID and resident information before approving or rejecting.</p>
          </div>

          <button className="modal-close-button" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="request-detail-grid">
          <DetailItem label="Resident Name" value={resident.name} />
          <DetailItem label="Status" value={resident.status} />
          <DetailItem label="Sitio / Area" value={resident.sitio} />
          <DetailItem label="Submitted Address" value={resident.address ?? resident.sitio} />
          <DetailItem label="Landmark" value={resident.landmark ?? 'No landmark provided'} />
          <DetailItem label="Mobility Constraint" value={resident.constraint} />
          <DetailItem label="Sex" value={resident.sex ?? 'Not specified'} />
          <DetailItem label="Birthdate" value={resident.birthdate ?? 'Not provided'} />
          <DetailItem
            label="Emergency Contact"
            value={`${resident.emergencyContactName ?? 'Not provided'} / ${resident.emergencyContactNo ?? 'Not provided'}`}
          />
          <DetailItem
            label="GPS Coordinates"
            value={
              resident.gpsLat && resident.gpsLong
                ? `${resident.gpsLat}, ${resident.gpsLong}`
                : 'No coordinates provided'
            }
          />
        </div>

        <section className="submitted-documents">
          <h4>Submitted ID / Verification Documents</h4>

          {documents.length === 0 ? (
            <p className="empty-documents">No submitted verification document was found for this resident.</p>
          ) : (
            <div className="document-list">
              {documents.map((document) => (
                <DocumentPreview key={document.id} document={document} />
              ))}
            </div>
          )}
        </section>

        <div className="request-modal-actions">
          <button className="secondary-button" onClick={onClose}>
            Close
          </button>

          <button
            className="reject-button"
            disabled={isProcessing || resident.status === 'Rejected'}
            onClick={handleOpenRejectPopup}
          >
            Reject
          </button>

          <button
            className="verify-button large"
            disabled={isProcessing || resident.status === 'Verified'}
            onClick={onVerify}
          >
            {isProcessing ? 'Processing...' : 'Verify Resident'}
          </button>
        </div>
      </section>

      {showRejectPopup && (
        <div className="reject-popup-backdrop">
          <section className="reject-popup-card">
            <h3>Reject Verification Request</h3>
            <p>
              Please add a note explaining why this resident request is rejected. This reason will
              be saved in the verification document record.
            </p>

            <textarea
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              placeholder="Example: Submitted ID is blurry, address does not match, or required document is missing."
              autoFocus
            />

            <div className="reject-popup-actions">
              <button className="secondary-button" onClick={handleCancelReject}>
                Cancel
              </button>

              <button className="reject-button" disabled={isProcessing} onClick={handleSubmitReject}>
                {isProcessing ? 'Rejecting...' : 'Submit Rejection'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

type DetailItemProps = {
  label: string
  value: string
}

function DetailItem({ label, value }: DetailItemProps) {
  return (
    <div className="request-detail-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
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
  const lowerUrl = url.toLowerCase()

  return (
    lowerUrl.endsWith('.png') ||
    lowerUrl.endsWith('.jpg') ||
    lowerUrl.endsWith('.jpeg') ||
    lowerUrl.endsWith('.webp') ||
    lowerUrl.includes('image')
  )
}
