import { useEffect, useState, type FormEvent } from 'react'
import { fetchDisabilityTypes, registerResident, type ResidentRegistrationInput } from '../api/residentProfileApi'

// Staff register a resident who cannot sign up in the app themselves
// (no phone, elderly, PWD). The resident gets the same login as an app
// sign-up: their contact number and the 6-digit PIN entered here.

type BarangayOption = { barangay_id: number; barangay_name: string }

type Props = {
  open: boolean
  // Admin: only their assigned barangay. Super Admin: every barangay.
  barangays: BarangayOption[]
  defaultBarangayId: number | null
  onClose: () => void
  // markVerified: staff checked the resident's ID in person.
  onRegistered: (uid: string, markVerified: boolean) => Promise<void>
}

const emptyForm = (barangayId: number | null): Omit<ResidentRegistrationInput, 'barangay_id'> & { barangay_id: number | '' } => ({
  f_name: '', m_name: '', l_name: '', contact_no: '', sex: 'female', birthdate: '',
  mobility_status: 'ambulatory', emerg_contact_name: '', emerg_contact_no: '',
  barangay_id: barangayId ?? '', sitio: '', address: '', landmark: '', gps_lat: '', gps_long: '',
  is_pregnant: false, vulnerability_needs: '', disability_ids: [], household: { household_name: '' },
})

export function RegisterResidentModal({ open, ...props }: Props) {
  if (!open) return null
  return <RegisterResidentForm {...props} />
}

function RegisterResidentForm({ barangays, defaultBarangayId, onClose, onRegistered }: Omit<Props, 'open'>) {
  const [form, setForm] = useState(() => emptyForm(defaultBarangayId ?? (barangays.length === 1 ? barangays[0].barangay_id : null)))
  const [pin, setPin] = useState('')
  const [markVerified, setMarkVerified] = useState(false)
  const [disabilityTypes, setDisabilityTypes] = useState<{ disability_id: number; disability_name: string }[]>([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const today = new Date().toLocaleDateString('en-CA')

  useEffect(() => {
    let cancelled = false
    fetchDisabilityTypes()
      .then((types) => { if (!cancelled) setDisabilityTypes(types) })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Unable to load disability categories.') })
    return () => { cancelled = true }
  }, [])

  function setField<K extends keyof typeof form>(field: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    if (form.barangay_id === '') { setError('Select the barangay.'); return }
    if (!/^\d{6}$/.test(pin)) { setError('The PIN must be 6 digits.'); return }
    if ((form.gps_lat === '') !== (form.gps_long === '')) { setError('Enter both GPS coordinates, or leave both blank.'); return }
    setError('')
    setSaving(true)
    try {
      const result = await registerResident({ ...form, barangay_id: form.barangay_id }, pin)
      await onRegistered(result.uid, markVerified)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to register. The form is kept so you can try again.')
    } finally {
      setSaving(false)
    }
  }

  function textField(field: 'f_name' | 'm_name' | 'l_name' | 'contact_no' | 'birthdate' | 'emerg_contact_name' | 'emerg_contact_no' | 'sitio' | 'address' | 'landmark', label: string, required = true, type = 'text') {
    return <label><span>{label}</span><input required={required} type={type} maxLength={field.includes('no') ? 30 : 200} max={type === 'date' ? today : undefined} value={form[field]} onChange={(e) => setField(field, e.target.value)} /></label>
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="register-resident-title">
      <section className="edit-modal">
        <div className="request-modal-header">
          <div><h3 id="register-resident-title">Register Resident</h3><p>For residents who cannot sign up in the app themselves.</p></div>
          <button type="button" className="modal-close-button" aria-label="Close resident registration" disabled={saving} onClick={onClose}>×</button>
        </div>
        {error && <p role="alert" className="dashboard-error">{error}</p>}
        <form onSubmit={submit}>
          <fieldset disabled={saving} className="resident-edit-fields">
            <legend>Resident and app login</legend>
            <div className="edit-form-grid">
              {textField('f_name', 'First name')}
              {textField('m_name', 'Middle name (optional)', false)}
              {textField('l_name', 'Last name')}
              {textField('contact_no', 'Contact number (app login)', true, 'tel')}
              <label><span>6-digit PIN (app login)</span><input required inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="new-password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} /></label>
              <label><span>Sex</span><select value={form.sex} onChange={(e) => setField('sex', e.target.value as ResidentRegistrationInput['sex'])}><option value="female">Female</option><option value="male">Male</option></select></label>
              {textField('birthdate', 'Birthdate', true, 'date')}
              {textField('emerg_contact_name', 'Emergency contact name')}
              {textField('emerg_contact_no', 'Emergency contact number', true, 'tel')}
            </div>
            <p>Give the resident their contact number and PIN so they can sign in to the app later.</p>
          </fieldset>
          <fieldset disabled={saving} className="resident-edit-fields">
            <legend>Location</legend>
            <div className="edit-form-grid">
              <label><span>Barangay</span><select required value={form.barangay_id} disabled={barangays.length <= 1} onChange={(e) => setField('barangay_id', e.target.value === '' ? '' : Number(e.target.value))}>
                {barangays.length !== 1 && <option value="">Select barangay…</option>}
                {barangays.map((b) => <option key={b.barangay_id} value={b.barangay_id}>{b.barangay_name}</option>)}
              </select></label>
              {textField('sitio', 'Sitio / purok (optional)', false)}
              {textField('address', 'Address (optional)', false)}
              {textField('landmark', 'Landmark (optional)', false)}
              <label><span>GPS latitude (optional)</span><input type="number" step="any" min={-90} max={90} value={form.gps_lat} onChange={(e) => setField('gps_lat', e.target.value)} /></label>
              <label><span>GPS longitude (optional)</span><input type="number" step="any" min={-180} max={180} value={form.gps_long} onChange={(e) => setField('gps_long', e.target.value)} /></label>
            </div>
            <p>Without GPS, the house pin starts at the barangay centre. Move it later with Edit.</p>
          </fieldset>
          <fieldset disabled={saving} className="resident-edit-fields">
            <legend>Vulnerability & assistance needs</legend>
            <div className="edit-form-grid">
              <label><span>Mobility</span><select value={form.mobility_status} onChange={(e) => setField('mobility_status', e.target.value as ResidentRegistrationInput['mobility_status'])}><option value="ambulatory">Ambulatory — walks independently</option><option value="semi_ambulatory">Semi-ambulatory — needs assistance</option><option value="non_ambulatory">Non-ambulatory — cannot walk</option></select></label>
              <label className="resident-check"><input type="checkbox" checked={form.is_pregnant} onChange={(e) => setField('is_pregnant', e.target.checked)} /><span>Pregnant</span></label>
            </div>
            <p>Disability categories</p>
            <div className="resident-disability-options">
              {disabilityTypes.map((type) => <label className="resident-check" key={type.disability_id}><input type="checkbox" checked={form.disability_ids.includes(type.disability_id)} onChange={(e) => setField('disability_ids', e.target.checked ? [...form.disability_ids, type.disability_id] : form.disability_ids.filter((id) => id !== type.disability_id))} /><span>{type.disability_name}</span></label>)}
            </div>
            <label className="resident-notes">Medical, equipment, and other assistance needs<textarea maxLength={2000} value={form.vulnerability_needs} onChange={(e) => setField('vulnerability_needs', e.target.value)} /></label>
          </fieldset>
          <fieldset disabled={saving} className="resident-edit-fields">
            <legend>Household and verification</legend>
            <div className="edit-form-grid">
              <label><span>Household name (optional)</span><input maxLength={200} placeholder={form.l_name ? `${form.l_name} Household` : 'Dela Cruz Household'} value={form.household.household_name} onChange={(e) => setField('household', { household_name: e.target.value })} /></label>
              <label className="resident-check"><input type="checkbox" checked={markVerified} onChange={(e) => setMarkVerified(e.target.checked)} /><span>I checked their ID in person: mark as verified</span></label>
            </div>
            <p>The resident becomes head of a new household. Add dependents afterwards with Edit.</p>
          </fieldset>
          <div className="request-modal-actions"><button type="button" className="secondary-button" disabled={saving} onClick={onClose}>Cancel</button><button type="submit" className="verify-button large" disabled={saving}>{saving ? 'Registering…' : 'Register Resident'}</button></div>
        </form>
      </section>
    </div>
  )
}
