import { useEffect, useState, type FormEvent } from 'react'
import { addStaffIdDocument, fetchDocumentTypes, removeIdDocument, type DocumentType } from '../api/residentProfileApi'
import type { AccountAction, AccountFilter, Resident, Status, VerificationDocument } from '../types/dashboard'
import { ResidentTable } from '../components/ResidentTable'
import { SidePanel } from '../components/SidePanel'
import { supabase } from '../lib/supabaseClient'
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
  // Reloads the resident list after staff add an ID.
  onReload?: () => Promise<void> | void
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
  onReload,
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
          onReload={onReload}
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
  onReload?: () => Promise<void> | void
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
  onReload,
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
  const rejection = resident.rejectionReason ?? documents.find((d) => d.rejectionReason)?.rejectionReason
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
            <dt>House photo</dt><dd><HousePhoto key={String(resident.id)} residentUid={String(resident.id)} /></dd>
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
            : <div className="document-list">{documents.map((document) => <DocumentPreview key={document.id} document={document} onRemoved={onReload} />)}</div>}
          <AddIdForm key={String(resident.id)} residentUid={String(resident.id)} hasIds={documents.length > 0} onAdded={onReload} />
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

// Staff add an ID for a resident who already has an account (e.g. they showed it in person,
// or registered without one). Same database call as Register resident.
function AddIdForm({ residentUid, hasIds, onAdded }: { residentUid: string; hasIds: boolean; onAdded?: () => Promise<void> | void }) {
  const [open, setOpen] = useState(false)
  const [types, setTypes] = useState<DocumentType[]>([])
  const [typeId, setTypeId] = useState('')
  const [idNumber, setIdNumber] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [approved, setApproved] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!open || types.length) return
    fetchDocumentTypes().then(setTypes).catch(() => setError('Could not load the ID types.'))
  }, [open, types.length])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!typeId) { setError('Select the ID type.'); return }
    if (!photo && !idNumber.trim()) { setError('Add the ID photo or the ID number.'); return }
    if (photo && photo.size > 10 * 1024 * 1024) { setError('The ID photo is too large (10 MB at most).'); return }
    setSaving(true); setError('')
    try {
      await addStaffIdDocument(residentUid, Number(typeId), idNumber, photo, approved)
      setSaved(true); setOpen(false); setTypeId(''); setIdNumber(''); setPhoto(null)
      await onAdded?.()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The ID could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return <>
      {saved && <p className="rd-muted" role="status">ID saved.</p>}
      <button type="button" className="secondary-button" onClick={() => { setOpen(true); setSaved(false) }}>{hasIds ? 'Add another ID' : 'Add ID'}</button>
    </>
  }
  return (
    <form onSubmit={submit} className="resident-edit-fields">
      {error && <p role="alert" className="dashboard-error">{error}</p>}
      <fieldset disabled={saving} className="resident-edit-fields">
        <div className="edit-form-grid">
          <label><span>ID type</span><select required value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            <option value="">Select ID type…</option>
            {types.map((t) => <option key={t.type_id} value={t.type_id}>{t.type_name}</option>)}
          </select></label>
          <label><span>ID number</span><input maxLength={100} value={idNumber} onChange={(e) => setIdNumber(e.target.value)} /></label>
          <label><span>ID photo</span><input type="file" accept="image/jpeg,image/png" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} /></label>
          <label className="resident-check"><input type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)} /><span>I checked this ID in person</span></label>
        </div>
      </fieldset>
      <div className="request-modal-actions">
        <button type="button" className="secondary-button" disabled={saving} onClick={() => { setOpen(false); setError('') }}>Cancel</button>
        <button type="submit" className="verify-button" disabled={saving}>{saving ? 'Saving…' : 'Save ID'}</button>
      </div>
    </form>
  )
}

// The front-of-house photo the resident took in the app (bucket house-facades), same as on the SOS card.
function HousePhoto({ residentUid }: { residentUid: string }) {
  const [state, setState] = useState<{ loading: boolean; url: string | null }>({ loading: true, url: null })
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: r } = await supabase.from('residents').select('house_photo_url').eq('uid', residentUid).maybeSingle()
      let url: string | null = null
      if (r?.house_photo_url) {
        const { data } = await supabase.storage.from('house-facades').createSignedUrl(String(r.house_photo_url), 60 * 30)
        url = data?.signedUrl ?? null
      }
      if (!cancelled) setState({ loading: false, url })
    })().catch(() => { if (!cancelled) setState({ loading: false, url: null }) })
    return () => { cancelled = true }
  }, [residentUid])
  if (state.loading) return <span className="rd-muted">Loading…</span>
  if (!state.url) return <span>No house photo yet</span>
  return <a href={state.url} target="_blank" rel="noreferrer" title="Open full size">
    <img src={state.url} alt="Front of the house"
      style={{ display: 'block', width: '100%', maxWidth: 260, height: 170, objectFit: 'cover', borderRadius: 8, border: '1px solid #e2e8f0' }} />
  </a>
}

type DocumentPreviewProps = {
  document: VerificationDocument
  onRemoved?: () => Promise<void> | void
}

function DocumentPreview({ document, onRemoved }: DocumentPreviewProps) {
  const isImage = isImageUrl(document.fileUrl)
  const [removing, setRemoving] = useState(false)
  const [removeError, setRemoveError] = useState('')

  async function remove() {
    if (!window.confirm(`Remove this ${document.typeName}? The ID and its photo are deleted. The Activity Log keeps who removed it.`)) return
    setRemoving(true); setRemoveError('')
    try {
      await removeIdDocument(document.id)
      await onRemoved?.()
    } catch (reason) {
      setRemoveError(reason instanceof Error ? reason.message : 'The ID could not be removed.')
      setRemoving(false)
    }
  }

  return (
    <article className="document-card">
      <div>
        <strong>{document.typeName}</strong>
        <span>Status: {document.reviewStatus}</span>
        <small>Uploaded: {document.uploadedAt}</small>
        <button type="button" className="link-button" disabled={removing} onClick={() => void remove()}>{removing ? 'Removing…' : 'Remove'}</button>
        {removeError && <small role="alert" className="dashboard-error">{removeError}</small>}
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
