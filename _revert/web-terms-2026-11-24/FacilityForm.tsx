import { useState, type FormEvent } from 'react'
import type { EvacuationCenter } from '../types/dashboard'
import { registerFacility, setFacilityCapacity } from '../api/facilityApi'
import { FACILITY_TYPES, facilityTypeLabel, validateCapacity, validateFacility } from '../utils/facility'
import { FacilityLocationPicker } from './FacilityLocationPicker'
import { SidePanel } from './SidePanel'
import '../pages/DispatchPage.css'

type Props = {
  center: EvacuationCenter | null
  // Existing facilities, shown on the location map when registering.
  existingCenters?: EvacuationCenter[]
  onClose: () => void
  onSaved: () => Promise<void>
  scopeBarangayId?: number | null
  // Super admins only; admins always register in their own barangay.
  barangayOptions?: { barangay_id: number; barangay_name: string }[]
}
export function FacilityForm({ center, existingCenters = [], barangayOptions, scopeBarangayId = null, onClose, onSaved }: Props) {
  const [name, setName] = useState('')
  const [type, setType] = useState<typeof FACILITY_TYPES[number]>('school')
  const [barangay, setBarangay] = useState('')
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
      else await registerFacility(input, barangayOptions ? (barangay ? Number(barangay) : null) : undefined)
      setSaved(true)
      try { await onSaved(); onClose() }
      catch { setError('Saved successfully, but the list could not refresh. Close this form and refresh the website. Do not register it again.') }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to save this facility.') }
    finally { setSaving(false) }
  }
  return <SidePanel title={center ? `Room for at ${center.name}` : 'Add a center'} onClose={onClose} error={error} busy={saving}>
      <form onSubmit={submit} className="ec-form"><fieldset disabled={saving || saved} className="ec-fieldset ec-plain">
        {!center && <>
          <label>Name<input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label>Type<select value={type} onChange={(e) => setType(e.target.value as typeof type)}>{FACILITY_TYPES.map((item) => <option key={item} value={item}>{item === 'makeshift' ? 'Temporary shelter (this disaster only)' : facilityTypeLabel(item)}</option>)}</select></label>
          {barangayOptions && <label>Barangay<select value={barangay} onChange={(e) => setBarangay(e.target.value)}>
            <option value="">Municipal (all barangays)</option>
            {barangayOptions.map((option) => <option key={option.barangay_id} value={option.barangay_id}>{option.barangay_name}</option>)}
          </select></label>}
          <div className="ec-picker">
            <span className="ec-label">Location: click the map or drag the pin</span>
            <FacilityLocationPicker
              latitude={latitude}
              longitude={longitude}
              centers={existingCenters}
              focusBarangayId={barangay ? Number(barangay) : scopeBarangayId}
              disabled={saving || saved}
              onChange={(lat, lng) => { setLatitude(lat); setLongitude(lng) }}
            />
          </div>
        </>}
        <label>Room for (people)<input required type="number" min={1} max={1_000_000} step={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} /></label>
        <p className="ec-hint">The safe limit approved for this place. The website records it; it does not check the building.</p>
      </fieldset>
      <div className="row-actions"><button type="button" className="secondary-button" disabled={saving} onClick={onClose}>{saved ? 'Close' : 'Cancel'}</button><button type="submit" className="primary-button" disabled={saving || saved || (!center && (!latitude || !longitude))}>{saving ? 'Saving…' : center ? 'Save' : 'Add center'}</button></div></form>
  </SidePanel>
}
