import { useEffect, useState, type FormEvent } from 'react'
import type { Resident } from '../types/dashboard'
import { fetchResidentProfile, fetchHousehold, type HouseholdMember, type ResidentProfileDetails, type ResidentProfileInput } from '../api/residentProfileApi'

type Props = {
  resident: Resident | null
  isSaving: boolean
  onClose: () => void
  onSave: (id: number | string, updates: ResidentProfileInput) => Promise<void>
}

export function EditResidentModal({ resident, ...props }: Props) {
  if (!resident) return null
  return <ResidentEditor key={resident.id} resident={resident} {...props} />
}

function ResidentEditor({ resident, isSaving, onClose, onSave }: Omit<Props, 'resident'> & { resident: Resident }) {
  const [details, setDetails] = useState<ResidentProfileDetails | null>(null)
  const [profile, setProfile] = useState<ResidentProfileInput | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [householdLoading, setHouseholdLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchResidentProfile(resident.id).then((result) => {
      if (!cancelled) { setDetails(result); setProfile(result.profile) }
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : 'Unable to load this profile.')
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [resident.id])

  function setField<K extends keyof ResidentProfileInput>(field: K, value: ResidentProfileInput[K]) {
    setProfile((current) => current ? { ...current, [field]: value } : current)
  }
  function setMember(index: number, values: Partial<HouseholdMember>) {
    if (!profile) return
    setField('household_members', profile.household_members.map((member, i) => i === index ? { ...member, ...values } : member))
  }
  async function selectHousehold(householdId: string) {
    if (!profile || !details) return
    setError('')
    if (!householdId) {
      setProfile({ ...profile, household_id: '', household_name: '', household_members: [], household_revision: null })
      setDetails({ ...details, registered_members: [] })
      return
    }
    setHouseholdLoading(true)
    try {
      const result = await fetchHousehold(householdId)
      setProfile({ ...profile, household_id: householdId, household_name: '', household_members: result.household_members, household_revision: result.household_revision })
      setDetails({ ...details, registered_members: result.registered_members })
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load household.') }
    finally { setHouseholdLoading(false) }
  }
  const today = new Date().toLocaleDateString('en-CA')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!profile || isSaving || householdLoading) return
    if (profile.household_members.length > 0 && !profile.household_id && !profile.household_name.trim()) {
      setError('Create or select a household before adding dependents.')
      return
    }
    setError('')
    try { await onSave(resident.id, profile) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to save. Your changes remain in this form.') }
  }

  function textField(field: 'f_name' | 'm_name' | 'l_name' | 'contact_no' | 'birthdate' | 'address' | 'landmark' | 'emerg_contact_name' | 'emerg_contact_no', label: string, required = true, type = 'text') {
    return <label><span>{label}</span><input required={required} type={type} maxLength={field.includes('no') ? 30 : 200} max={type === 'date' ? today : undefined} value={profile?.[field] ?? ''} onChange={(e) => setField(field, e.target.value)} /></label>
  }
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="resident-editor-title">
      <section className="edit-modal">
        <div className="request-modal-header">
          <div><h3 id="resident-editor-title">Edit Demographics & Household Needs</h3><p>{resident.name} · {details?.sitio_name ?? resident.sitio}</p></div>
          <button type="button" className="modal-close-button" aria-label="Close resident editor" disabled={isSaving} onClick={onClose}>×</button>
        </div>
        {loading && <p role="status">Loading resident profile…</p>}
        {error && <p role="alert" className="dashboard-error">{error}</p>}
        {profile && details && <form onSubmit={submit}>
          <fieldset disabled={isSaving || householdLoading} className="resident-edit-fields">
            <legend>Resident demographics</legend>
            <div className="edit-form-grid">
              {textField('f_name', 'First name')}
              {textField('m_name', 'Middle name (optional)', false)}
              {textField('l_name', 'Last name')}
              {textField('contact_no', 'Contact number', true, 'tel')}
              <label><span>Sex</span><select value={profile.sex} onChange={(e) => setField('sex', e.target.value as ResidentProfileInput['sex'])}><option value="male">Male</option><option value="female">Female</option></select></label>
              {textField('birthdate', 'Birthdate', true, 'date')}
              {textField('address', 'Submitted address', false)}
              {textField('landmark', 'Landmark', false)}
              <label><span>GPS latitude</span><input required type="number" step="any" min={-90} max={90} value={profile.gps_lat} onChange={(e) => setField('gps_lat', Number(e.target.value))} /></label>
              <label><span>GPS longitude</span><input required type="number" step="any" min={-180} max={180} value={profile.gps_long} onChange={(e) => setField('gps_long', Number(e.target.value))} /></label>
              {textField('emerg_contact_name', 'Emergency contact name')}
              {textField('emerg_contact_no', 'Emergency contact number', true, 'tel')}
            </div>
          </fieldset>
          <fieldset disabled={isSaving || householdLoading} className="resident-edit-fields">
            <legend>Vulnerability & assistance needs</legend>
            <div className="edit-form-grid">
              <label><span>Mobility</span><select value={profile.mobility_status} onChange={(e) => setField('mobility_status', e.target.value as ResidentProfileInput['mobility_status'])}><option value="ambulatory">Ambulatory — walks independently</option><option value="semi_ambulatory">Semi-ambulatory — needs assistance</option><option value="non_ambulatory">Non-ambulatory — cannot walk</option></select></label>
              <label className="resident-check"><input type="checkbox" checked={profile.is_pregnant} onChange={(e) => setField('is_pregnant', e.target.checked)} /><span>Pregnant</span></label>
            </div>
            <p>Disability categories</p>
            <div className="resident-disability-options">
              {details.disability_types.map((type) => <label className="resident-check" key={type.disability_id}><input type="checkbox" checked={profile.disability_ids.includes(type.disability_id)} onChange={(e) => setField('disability_ids', e.target.checked ? [...profile.disability_ids, type.disability_id] : profile.disability_ids.filter((id) => id !== type.disability_id))} /><span>{type.disability_name}</span></label>)}
              {details.disability_types.length === 0 && <p>No disability categories have been configured.</p>}
            </div>
            <label className="resident-notes">Medical, equipment, and other assistance needs<textarea maxLength={2000} value={profile.vulnerability_needs} onChange={(e) => setField('vulnerability_needs', e.target.value)} /></label>
          </fieldset>
          <fieldset disabled={isSaving || householdLoading} className="resident-edit-fields">
            <legend>Shared household</legend>
            <div className="edit-form-grid">
              <label><span>Household in this sitio</span><select value={profile.household_id} onChange={(e) => void selectHousehold(e.target.value)}><option value="">No household / create a new one</option>{details.households.map((household) => <option key={household.household_id} value={household.household_id}>{household.household_name} — Head: {household.head_name}</option>)}</select></label>
              {!profile.household_id && <label><span>New household name (optional)</span><input maxLength={200} value={profile.household_name} onChange={(e) => setField('household_name', e.target.value)} placeholder="Dela Cruz household" /></label>}
            </div>
            {!profile.household_id && <p>Creating a household makes this resident its head. Other resident accounts in this sitio can join it using this same selector.</p>}
            {details.registered_members.length > 0 && <><h4>Registered household members</h4>{details.registered_members.map((member) => <p key={member.uid}>{member.name}{member.is_head ? ' (Household head)' : ''}</p>)}</>}
            <h4>Dependents without resident accounts</h4>
            <p>These dependents are shared across the household. Do not duplicate someone with their own resident account. Unknown birthdates can be left blank.</p>
            {profile.household_members.map((member, index) => <section className="resident-household-member" key={index}>
              <h4>Member {index + 1}</h4>
              <div className="edit-form-grid">
                <label><span>Full name</span><input required maxLength={200} value={member.name} onChange={(e) => setMember(index, { name: e.target.value })} /></label>
                <label><span>Relationship</span><input required maxLength={80} placeholder="Child, parent, spouse…" value={member.relationship} onChange={(e) => setMember(index, { relationship: e.target.value })} /></label>
                <label><span>Birthdate (optional)</span><input type="date" max={today} value={member.birthdate} onChange={(e) => setMember(index, { birthdate: e.target.value })} /></label>
                <label><span>Sex (optional)</span><select value={member.sex} onChange={(e) => setMember(index, { sex: e.target.value as HouseholdMember['sex'] })}><option value="">Not recorded</option><option value="male">Male</option><option value="female">Female</option></select></label>
                <label className="resident-check"><input type="checkbox" checked={member.is_pregnant} onChange={(e) => setMember(index, { is_pregnant: e.target.checked })} /><span>Pregnant</span></label>
                <label><span>Disability / assistance needs</span><input maxLength={2000} value={member.needs} onChange={(e) => setMember(index, { needs: e.target.value })} /></label>
              </div>
              <button type="button" className="secondary-button" onClick={() => setField('household_members', profile.household_members.filter((_, i) => i !== index))}>Remove from draft</button>
            </section>)}
            <button type="button" className="secondary-button" disabled={profile.household_members.length >= 30} onClick={() => setField('household_members', [...profile.household_members, { name: '', relationship: '', birthdate: '', sex: '', is_pregnant: false, needs: '' }])}>Add dependent</button>
          </fieldset>
          <p>Verification and sitio assignment stay in their existing workflows. VPI scoring is unchanged until an approved formula is provided.</p>
          <div className="request-modal-actions"><button type="button" className="secondary-button" disabled={isSaving || householdLoading} onClick={onClose}>Cancel</button><button type="submit" className="verify-button large" disabled={isSaving || householdLoading}>{householdLoading ? 'Loading household…' : isSaving ? 'Saving…' : 'Save Changes'}</button></div>
        </form>}
        {!profile && !loading && <button type="button" className="secondary-button" onClick={onClose}>Close</button>}
      </section>
    </div>
  )
}
