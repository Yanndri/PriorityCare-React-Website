import { useState, type FormEvent } from 'react'
import type { EvacuationCenter } from '../types/dashboard'
import { registerFacility, setFacilityCapacity } from '../api/facilityApi'
import { FACILITY_TYPES, validateCapacity, validateFacility } from '../utils/facility'

type Props = { center: EvacuationCenter | null; onClose: () => void; onSaved: () => Promise<void> }
export function FacilityForm({ center, onClose, onSaved }: Props) {
  const [name, setName] = useState('')
  const [type, setType] = useState<typeof FACILITY_TYPES[number]>('school')
  const [latitude, setLatitude] = useState('')
  const [longitude, setLongitude] = useState('')
  const [capacity, setCapacity] = useState(center?.capacityConfirmed ? String(center.capacity) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    const input = { name, type, latitude: Number(latitude), longitude: Number(longitude), capacity: Number(capacity) }
    const validation = center ? validateCapacity(input.capacity) : validateFacility(input)
    if (validation) { setError(validation); return }
    setSaving(true); setError('')
    try {
      if (center?.id != null) await setFacilityCapacity(center.id, input.capacity, center.capacityConfirmed ? center.capacity : null)
      else await registerFacility(input)
      setSaved(true)
      try { await onSaved(); onClose() }
      catch { setError('Saved successfully, but the list could not refresh. Close this form and refresh the website. Do not register it again.') }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to save this facility.') }
    finally { setSaving(false) }
  }
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="facility-form-title">
    <section className="edit-modal"><div className="request-modal-header"><div><h3 id="facility-form-title">{center ? 'Set Maximum Safe Capacity' : 'Register Evacuation Facility'}</h3><p>{center?.name ?? 'Add a predefined or temporary evacuation facility.'}</p></div><button type="button" className="modal-close-button" disabled={saving} aria-label="Close facility form" onClick={onClose}>×</button></div>
      {error && <p role="alert" className="dashboard-error">{error}</p>}
      <form onSubmit={submit}><fieldset disabled={saving || saved} className="resident-edit-fields"><div className="edit-form-grid">
        {!center && <>
          <label><span>Facility name</span><input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label><span>Facility type</span><select value={type} onChange={(e) => setType(e.target.value as typeof type)}>{FACILITY_TYPES.map((item) => <option key={item} value={item}>{item.replaceAll('_', ' ')}</option>)}</select></label>
          <label><span>GPS latitude</span><input required type="number" step="any" min={-90} max={90} value={latitude} onChange={(e) => setLatitude(e.target.value)} /></label>
          <label><span>GPS longitude</span><input required type="number" step="any" min={-180} max={180} value={longitude} onChange={(e) => setLongitude(e.target.value)} /></label>
        </>}
        <label><span>Maximum safe capacity (people)</span><input required type="number" min={1} max={1_000_000} step={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} /></label>
      </div></fieldset><p>Enter the limit approved for this facility. The website records this value; it does not assess structural safety.</p>
      <div className="request-modal-actions"><button type="button" className="secondary-button" disabled={saving} onClick={onClose}>{saved ? 'Close' : 'Cancel'}</button><button type="submit" className="verify-button large" disabled={saving || saved}>{saving ? 'Saving…' : center ? 'Save Capacity' : 'Register Facility'}</button></div></form>
    </section>
  </div>
}
