import { useRef, useState, type FormEvent } from 'react'
import {
  createAdmin,
  UUID_PATTERN,
  type Barangay,
} from '../api/superAdminApi'

type CreateAdminFormProps = {
  barangays: Barangay[]
  onCreated: () => void | Promise<void>
}

const emptyForm = {
  uid: '',
  email: '',
  password: '',
  f_name: '',
  m_name: '',
  l_name: '',
  contact_no: '',
  assigned_barangay_id: '',
}

type FormState = typeof emptyForm

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// Mirrors the backend rule: optional +, then digits, spaces, or hyphens.
const CONTACT_PATTERN = /^\+?[0-9][0-9\s-]*$/

function validate(form: FormState, barangays: Barangay[]): string | null {
  if (
    !form.email.trim() ||
    !form.f_name.trim() ||
    !form.l_name.trim() ||
    !form.contact_no.trim()
  ) {
    return 'Email, first name, last name, and contact number are required.'
  }

  if (!EMAIL_PATTERN.test(form.email.trim())) {
    return 'Please enter a valid email address.'
  }

  if (form.password.length < 8) {
    return 'Password must be at least 8 characters long.'
  }

  if (new TextEncoder().encode(form.password).length > 72) {
    return 'Password must be at most 72 characters long.'
  }

  if (
    form.email.trim().length > 100 ||
    form.f_name.trim().length > 100 ||
    form.m_name.trim().length > 100 ||
    form.l_name.trim().length > 100
  ) {
    return 'Email and names must be at most 100 characters.'
  }

  const contact = form.contact_no.trim()
  const contactDigits = contact.replace(/\D/g, '')

  if (
    !CONTACT_PATTERN.test(contact) ||
    contactDigits.length < 7 ||
    contactDigits.length > 15
  ) {
    return 'Contact number must contain 7 to 15 digits (an optional leading +, spaces, and hyphens are allowed).'
  }

  const barangayId = Number(form.assigned_barangay_id)

  if (!barangays.some((barangay) => barangay.barangay_id === barangayId)) {
    return 'Please select a valid Barangay.'
  }

  return null
}

export function CreateAdminForm({ barangays, onCreated }: CreateAdminFormProps) {
  const [form, setForm] = useState<FormState>(emptyForm)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  // Guards against double submits before the disabled button re-renders.
  const inFlight = useRef(false)

  const update = (field: keyof FormState) =>
    (event: { target: { value: string } }) => {
      setForm((current) => ({ ...current, [field]: event.target.value }))
    }

  const uidInvalid =
    form.uid.trim().length > 0 && !UUID_PATTERN.test(form.uid.trim())

  const generateUid = () => {
    setForm((current) => ({ ...current, uid: crypto.randomUUID() }))
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (inFlight.current) return
    setError('')
    setSuccess('')

    if (uidInvalid) {
      setError('User ID must be a valid UUID, or left blank to auto-generate.')
      return
    }

    const validationError = validate(form, barangays)

    if (validationError) {
      setError(validationError)
      return
    }

    inFlight.current = true
    setSubmitting(true)

    try {
      const result = await createAdmin({
        uid: form.uid.trim() || undefined,
        email: form.email.trim(),
        password: form.password,
        f_name: form.f_name.trim(),
        m_name: form.m_name.trim() || undefined,
        l_name: form.l_name.trim(),
        contact_no: form.contact_no.trim(),
        assigned_barangay_id: Number(form.assigned_barangay_id),
      })

      const barangayName =
        barangays.find(
          (barangay) => barangay.barangay_id === Number(form.assigned_barangay_id),
        )?.barangay_name ?? 'the selected barangay'

      setSuccess(
        `Admin ${result.admin?.email ?? form.email.trim()} created for ${barangayName}` +
          (result.admin?.uid ? ` (User ID ${result.admin.uid}).` : '.'),
      )
      setForm(emptyForm)
      await onCreated()
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to create the Admin account.',
      )
    } finally {
      inFlight.current = false
      setSubmitting(false)
    }
  }

  return (
    <section className="super-admin-section create-admin-section">
      <h2>Create Admin</h2>
      <p>
        Create an administrator account and assign it to a barangay. Leave
        User ID blank to auto-generate one.
      </p>

      <form className="create-admin-form" onSubmit={(e) => void handleSubmit(e)}>
        <label className="create-admin-field create-admin-field-wide">
          <span>User ID (UUID, optional)</span>
          <div className="create-admin-uid-row">
            <input
              type="text"
              value={form.uid}
              onChange={update('uid')}
              placeholder="Auto-generated if blank"
              aria-invalid={uidInvalid}
              spellCheck={false}
              autoComplete="off"
            />
            <button type="button" onClick={generateUid} disabled={submitting}>
              Generate
            </button>
          </div>
          {uidInvalid && (
            <small className="create-admin-hint-error">
              Must look like 123e4567-e89b-12d3-a456-426614174000
            </small>
          )}
        </label>

        <label className="create-admin-field">
          <span>Assigned Barangay *</span>
          <select
            value={form.assigned_barangay_id}
            onChange={update('assigned_barangay_id')}
            required
          >
            <option value="" disabled>
              Select a barangay
            </option>
            {barangays.map((barangay) => (
              <option key={barangay.barangay_id} value={barangay.barangay_id}>
                {barangay.barangay_name} (ID {barangay.barangay_id})
              </option>
            ))}
          </select>
        </label>

        <label className="create-admin-field">
          <span>Email *</span>
          <input
            type="email"
            value={form.email}
            onChange={update('email')}
            maxLength={100}
            required
            autoComplete="off"
          />
        </label>

        <label className="create-admin-field">
          <span>Password * (min. 8 characters)</span>
          <input
            type="password"
            value={form.password}
            onChange={update('password')}
            minLength={8}
            maxLength={72}
            required
            autoComplete="new-password"
          />
        </label>

        <label className="create-admin-field">
          <span>Contact No. *</span>
          <input
            type="tel"
            value={form.contact_no}
            onChange={update('contact_no')}
            maxLength={50}
            placeholder="e.g. 09171234567"
            required
          />
        </label>

        <label className="create-admin-field">
          <span>First Name *</span>
          <input type="text" value={form.f_name} onChange={update('f_name')} maxLength={100} required />
        </label>

        <label className="create-admin-field">
          <span>Middle Name</span>
          <input type="text" value={form.m_name} onChange={update('m_name')} maxLength={100} />
        </label>

        <label className="create-admin-field">
          <span>Last Name *</span>
          <input type="text" value={form.l_name} onChange={update('l_name')} maxLength={100} required />
        </label>

        {error && (
          <p role="alert" className="create-admin-message dashboard-error">
            {error}
          </p>
        )}
        {success && (
          <p role="status" className="create-admin-message create-admin-success">
            {success}
          </p>
        )}

        <div className="create-admin-actions">
          <button type="submit" disabled={submitting || barangays.length === 0}>
            {submitting ? 'Creating...' : 'Create Admin'}
          </button>
        </div>
      </form>
    </section>
  )
}
