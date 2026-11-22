import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  createRescuer,
  listResponders,
  updateRescuer,
  type Accreditation,
  type Barangay,
  type Responder,
  type ResponderDetails,
} from '../api/superAdminApi'
import { supabase } from '../lib/supabaseClient'
import { resetLogin } from '../api/residentProfileApi'

// Municipal admin only. Rescuers cannot sign up themselves: under RA 10121
// Sec. 13 and NDRRMC MC No. 64 s. 2021 (amended by MC No. 02 s. 2024),
// community disaster volunteers are accredited and given IDs at the
// municipal/city level through the LDRRMO, and fielded by an organization.

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date())
const inYears = (iso: string, years: number) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y + years, m - 1, d - 1)).toISOString().slice(0, 10)
}
const addDays = (iso: string, days: number) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

// Trainings are typed as one comma-separated line.
const splitList = (text: string) => text.split(',').map((item) => item.trim()).filter(Boolean)
type AccreditationDraft = Omit<Accreditation, 'trainings' | 'insurance_ref'> & { trainings: string; insurance_ref: string }
const toAccreditation = (d: AccreditationDraft): Accreditation => ({ ...d, trainings: splitList(d.trainings), insurance_ref: d.insurance_ref.trim() || undefined })

const emptyForm = () => ({
  f_name: '', m_name: '', l_name: '', email: '', contact_no: '', password: '', assigned_barangay_id: '',
  accreditation_no: '', organization: '', accredited_on: today(), valid_until: inYears(today(), 2),
  trainings: '', insurance_ref: '',
})

function accreditationLabel(r: Responder) {
  if (!r.valid_until) return { text: 'No accreditation on file', tone: 'load-over' }
  if (r.valid_until < today()) return { text: `Expired ${r.valid_until}`, tone: 'load-over' }
  if (r.valid_until <= addDays(today(), 90)) return { text: `Expires ${r.valid_until}`, tone: 'load-near' }
  return { text: `Valid until ${r.valid_until}`, tone: 'load-ok' }
}

export function ResponderAccountsPage() {
  const [responders, setResponders] = useState<Responder[]>([])
  const [barangays, setBarangays] = useState<Barangay[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [form, setForm] = useState<ReturnType<typeof emptyForm> | null>(null)
  const [renewing, setRenewing] = useState<{ uid: string; name: string; draft: AccreditationDraft } | null>(null)
  const [editing, setEditing] = useState<{ uid: string; oldEmail: string; draft: Omit<ResponderDetails, 'assigned_barangay_id' | 'm_name'> & { m_name: string; assigned_barangay_id: string } } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [list, brgy] = await Promise.all([
        listResponders(),
        supabase.from('barangays').select('barangay_id, barangay_name').order('barangay_name'),
      ])
      if (brgy.error) throw brgy.error
      setResponders(list)
      setBarangays((brgy.data ?? []) as Barangay[])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load responders.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    void load()
  }, [load])

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
      setNotice(done)
      await load()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!form) return
    if (!form.assigned_barangay_id) { setError('Select the responder\'s barangay.'); return }
    const ok = await run(() => createRescuer({
      ...form,
      ...toAccreditation(form),
      m_name: form.m_name || undefined,
      assigned_barangay_id: Number(form.assigned_barangay_id),
    }), `${form.f_name} ${form.l_name} can now sign in to the responder app with ${form.email}. Add them to a unit in Dispatch.`)
    if (ok) setForm(null)
  }

  async function renew(event: FormEvent) {
    event.preventDefault()
    if (!renewing) return
    const ok = await run(() => updateRescuer(renewing.uid, toAccreditation(renewing.draft)), `Accreditation for ${renewing.name} saved.`)
    if (ok) setRenewing(null)
  }

  async function saveDetails(event: FormEvent) {
    event.preventDefault()
    if (!editing) return
    const d = editing.draft
    if (!d.assigned_barangay_id) { setError('Select the responder\'s barangay.'); return }
    const emailChanged = d.email.trim().toLowerCase() !== editing.oldEmail.toLowerCase()
    const name = [d.f_name, d.m_name, d.l_name].map((part) => part.trim()).filter(Boolean).join(' ')
    const ok = await run(() => updateRescuer(editing.uid, { details: {
      ...d, m_name: d.m_name.trim() || null, assigned_barangay_id: Number(d.assigned_barangay_id),
    } }), emailChanged
      ? `Details for ${name} saved. They now sign in with ${d.email.trim().toLowerCase()}; their password is unchanged.`
      : `Details for ${name} saved.`)
    if (ok) setEditing(null)
  }

  const editField = (name: keyof NonNullable<typeof editing>['draft'], label: string, props: Record<string, unknown> = {}) => editing &&
    <label><span>{label}</span><input value={editing.draft[name]} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, [name]: e.target.value } })} {...props} /></label>

  const field = (name: keyof ReturnType<typeof emptyForm>, label: string, props: Record<string, unknown> = {}) => form &&
    <label><span>{label}</span><input value={form[name]} onChange={(e) => setForm({ ...form, [name]: e.target.value })} {...props} /></label>

  return <section className="panel catchment-panel">
    <div className="section-header">
      <div><h3>Responder Accounts</h3></div>
      <div>
        <button type="button" className="secondary-button" disabled={loading || busy} onClick={() => void load()}>Refresh</button>{' '}
        <button type="button" className="verify-button" disabled={busy} onClick={() => { setForm(emptyForm()); setEditing(null); setRenewing(null); setNotice('') }}>Add Responder</button>
      </div>
    </div>
    <p className="catchment-muted">
      Responders cannot sign up in the app. Register them here after the LDRRMO accredits them as community disaster volunteers
      (RA 10121 Sec. 13; NDRRMC MC No. 64 s. 2021, as amended). Only responders with current accreditation can be added to a response unit.
    </p>
    {error && <p role="alert" className="dashboard-error">{error}</p>}
    {notice && <p role="status" className="catchment-notice">{notice}</p>}

    {form && <form className="edit-form-grid" onSubmit={(e) => void submit(e)}>
      {field('f_name', 'First name', { required: true, maxLength: 100 })}
      {field('m_name', 'Middle name', { maxLength: 100 })}
      {field('l_name', 'Last name', { required: true, maxLength: 100 })}
      {field('contact_no', 'Contact number', { required: true, maxLength: 50 })}
      {field('email', 'Login email', { required: true, type: 'email', maxLength: 100 })}
      {field('password', 'Temporary password (8+ characters)', { required: true, type: 'password', minLength: 8, autoComplete: 'new-password' })}
      <label><span>Barangay</span><select required value={form.assigned_barangay_id} onChange={(e) => setForm({ ...form, assigned_barangay_id: e.target.value })}>
        <option value="">Select…</option>
        {barangays.map((b) => <option key={b.barangay_id} value={b.barangay_id}>{b.barangay_name}</option>)}
      </select></label>
      {field('organization', 'Fielding organization (e.g. Gabi BDRRMC ERT)', { required: true, maxLength: 150 })}
      {field('accreditation_no', 'CDV accreditation / ID number', { required: true, maxLength: 50 })}
      {field('accredited_on', 'Accredited on', { required: true, type: 'date' })}
      {field('valid_until', 'Valid until', { required: true, type: 'date' })}
      {field('trainings', 'Trainings (comma-separated, e.g. BLS, WASAR, ICS)', { maxLength: 1000 })}
      {field('insurance_ref', 'Accident insurance policy no. (optional)', { maxLength: 100 })}
      <div>
        <button type="submit" className="verify-button" disabled={busy}>{busy ? 'Saving…' : 'Create Account'}</button>{' '}
        <button type="button" className="secondary-button" disabled={busy} onClick={() => setForm(null)}>Cancel</button>
      </div>
    </form>}

    {editing && <form className="edit-form-grid" onSubmit={(e) => void saveDetails(e)}>
      <p><strong>Edit details for {editing.draft.f_name || 'responder'} {editing.draft.l_name}</strong></p>
      {editField('f_name', 'First name', { required: true, maxLength: 100 })}
      {editField('m_name', 'Middle name', { maxLength: 100 })}
      {editField('l_name', 'Last name', { required: true, maxLength: 100 })}
      {editField('contact_no', 'Contact number', { required: true, maxLength: 50 })}
      {editField('email', 'Login email', { required: true, type: 'email', maxLength: 100 })}
      <label><span>Barangay</span><select required value={editing.draft.assigned_barangay_id} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, assigned_barangay_id: e.target.value } })}>
        <option value="">Select…</option>
        {barangays.map((b) => <option key={b.barangay_id} value={b.barangay_id}>{b.barangay_name}</option>)}
      </select></label>
      {editing.draft.email.trim().toLowerCase() !== editing.oldEmail.toLowerCase() &&
        <p className="catchment-muted">This also changes the email they use to sign in to the responder app. Their password stays the same. Tell them before you save.</p>}
      <div>
        <button type="submit" className="verify-button" disabled={busy}>{busy ? 'Saving…' : 'Save Details'}</button>{' '}
        <button type="button" className="secondary-button" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
      </div>
    </form>}

    {renewing && <form className="edit-form-grid" onSubmit={(e) => void renew(e)}>
      <p><strong>Accreditation for {renewing.name}</strong></p>
      {(['organization', 'accreditation_no', 'accredited_on', 'valid_until', 'trainings', 'insurance_ref'] as const).map((key) =>
        <label key={key}><span>{{ organization: 'Fielding organization', accreditation_no: 'CDV accreditation / ID number', accredited_on: 'Accredited on', valid_until: 'Valid until', trainings: 'Trainings (comma-separated)', insurance_ref: 'Accident insurance policy no. (optional)' }[key]}</span>
          <input required={key !== 'trainings' && key !== 'insurance_ref'} type={key.endsWith('_on') || key === 'valid_until' ? 'date' : 'text'} value={renewing.draft[key]}
            onChange={(e) => setRenewing({ ...renewing, draft: { ...renewing.draft, [key]: e.target.value } })} /></label>)}
      <div>
        <button type="submit" className="verify-button" disabled={busy}>Save Accreditation</button>{' '}
        <button type="button" className="secondary-button" disabled={busy} onClick={() => setRenewing(null)}>Cancel</button>
      </div>
    </form>}

    {loading ? <p role="status">Loading responders…</p> : <div className="catchment-table-wrap"><table className="catchment-table">
      <thead><tr><th>Responder</th><th>Barangay</th><th>Accreditation</th><th>Units</th><th>Account</th><th /></tr></thead>
      <tbody>{responders.map((r) => {
        const label = accreditationLabel(r)
        return <tr key={r.uid}>
          <td><strong>{r.name}</strong><div className="catchment-muted"><small>{r.email}{r.contact_no ? ` · ${r.contact_no}` : ''}</small></div></td>
          <td>{r.barangay_name ?? '—'}</td>
          <td>{r.accreditation_no ?? '—'}<div className="catchment-muted"><small>{r.organization ?? ''}{r.trainings?.length ? ` · ${r.trainings.join(', ')}` : ''}{r.valid_until && !r.insurance_ref ? ' · no insurance on file' : ''}</small></div>
            <span className={`catchment-load ${label.tone}`}>{label.text}</span></td>
          <td>{r.units.length ? r.units.join(', ') : '—'}</td>
          <td>{r.account_status === 'active' ? 'Active' : 'Suspended'}{!r.deployable && <div className="catchment-muted"><small>Not deployable</small></div>}</td>
          <td>
            <button type="button" className="secondary-button" disabled={busy} onClick={() => {
              setForm(null); setRenewing(null); setNotice('')
              setEditing({ uid: r.uid, oldEmail: r.email, draft: {
                f_name: r.f_name ?? '', m_name: r.m_name ?? '', l_name: r.l_name ?? '', contact_no: r.contact_no ?? '',
                email: r.email, assigned_barangay_id: r.barangay_id ? String(r.barangay_id) : '',
              } })
            }}>Edit details</button>{' '}
            <button type="button" className="secondary-button" disabled={busy} onClick={() => setRenewing({ uid: r.uid, name: r.name, draft: {
              organization: r.organization ?? '', accreditation_no: r.accreditation_no ?? '',
              accredited_on: r.accredited_on ?? today(), valid_until: r.valid_until && r.valid_until > today() ? r.valid_until : inYears(today(), 2),
              trainings: (r.trainings ?? []).join(', '), insurance_ref: r.insurance_ref ?? '',
            } })}>{r.valid_until ? 'Renew' : 'Add accreditation'}</button>{' '}
            <button type="button" className="secondary-button" disabled={busy}
              onClick={() => void run(() => updateRescuer(r.uid, { account_status: r.account_status === 'active' ? 'suspended' : 'active' }),
                `${r.name} ${r.account_status === 'active' ? 'suspended' : 'reactivated'}.`)}>
              {r.account_status === 'active' ? 'Suspend' : 'Reactivate'}</button>{' '}
            <button type="button" className="secondary-button" disabled={busy}
              title="Forgot password: set a new one after checking their ID"
              onClick={() => {
                if (!window.confirm(`Reset the password for ${r.name}? Their old password stops working right away. You will see the new one once.`)) return
                void run(async () => {
                  const { secret } = await resetLogin(r.uid)
                  window.alert(`New password for ${r.name} (${r.email}): ${secret}\n\nGive it to them in person. It is not shown again.`)
                }, `Password reset for ${r.name}.`)
              }}>Reset password</button>
          </td>
        </tr>
      })}</tbody>
    </table>
    {!responders.length && <p className="catchment-muted">No responder accounts yet.</p>}</div>}
  </section>
}
