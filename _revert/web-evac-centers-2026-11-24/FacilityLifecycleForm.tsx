import { useState, type FormEvent } from 'react'
import type { EvacuationCenter } from '../types/dashboard'
import { changeFacilityStatus } from '../api/facilityApi'

export function FacilityLifecycleForm({ center, onClose, onSaved }: {
  center: EvacuationCenter; onClose: () => void; onSaved: () => Promise<void>
}) {
  const reopening = center.status.toLowerCase() === 'closed'
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving || !confirmed || !reason.trim() || center.id == null) return
    setSaving(true); setError('')
    try {
      await changeFacilityStatus(center.id, reopening ? 'active' : 'closed', reason.trim(), reopening ? 'closed' : 'active')
      setSaved(true)
      try { await onSaved(); onClose() }
      catch { setError('Status saved, but the list could not refresh. Close this form and refresh the page.') }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to change facility status.') }
    finally { setSaving(false) }
  }
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="lifecycle-title">
    <section className="edit-modal"><div className="request-modal-header"><div><h3 id="lifecycle-title">{reopening ? 'Reopen' : 'Close'} Evacuation Center</h3><p>{center.name}</p></div><button className="modal-close-button" aria-label="Close status form" disabled={saving} onClick={onClose}>×</button></div>
      <p>{reopening ? 'Reopening makes this facility available again. Check its safe capacity before admitting residents.' : 'Closing retains the facility and its history, excludes it from available capacity and relief planning, and blocks new admission records. Transfer residents and resolve pending/in-transit records first.'}</p>
      {error && <p className="dashboard-error" role="alert">{error}</p>}
      <form onSubmit={submit}><fieldset className="resident-edit-fields" disabled={saving || saved}>
        <label className="resident-notes">Reason (required)<textarea required maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <label className="resident-check"><input required type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /><span>I reviewed the facility status and want to {reopening ? 'reopen' : 'close'} this center.</span></label>
      </fieldset><div className="request-modal-actions"><button type="button" className="secondary-button" disabled={saving} onClick={onClose}>{saved ? 'Close form' : 'Cancel'}</button><button type="submit" className="verify-button" disabled={saving || saved || !confirmed || !reason.trim()}>{saving ? 'Saving…' : reopening ? 'Reopen Center' : 'Close Center'}</button></div></form>
    </section>
  </div>
}
