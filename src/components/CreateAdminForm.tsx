import { useState, type FormEvent } from 'react'
import {
  createAdmin,
  UUID_PATTERN,
  type Sitio,
} from '../api/superAdminApi'

type CreateAdminFormProps = {
  sitios: Sitio[]
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
  assigned_sitio_id: '',
}

type FormState = typeof emptyForm

export function CreateAdminForm({ sitios, onCreated }: CreateAdminFormProps) {
  const [form, setForm] = useState<FormState>(emptyForm)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

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
    setError('')
    setSuccess('')

    if (uidInvalid) {
      setError('User ID must be a valid UUID, or left blank to auto-generate.')
      return
    }

    if (form.password.length < 8) {
      setError('Password must be at least 8 characters long.')
      return
    }

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
        assigned_sitio_id: Number(form.assigned_sitio_id),
      })

      const sitioName =
        sitios.find(
          (sitio) => sitio.sitio_id === Number(form.assigned_sitio_id),
        )?.sitio_name ?? 'the selected sitio'

      setSuccess(
        `Admin ${result.admin?.email ?? form.email.trim()} created for ${sitioName}` +
          (result.admin?.uid ? ` (User ID ${result.admin.uid}).` : '.'),
      )
      setForm(emptyForm)
      await onCreated()
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to create the Admin account.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="super-admin-section create-admin-section">
      <h2>Create Admin</h2>
      <p>
        Create an administrator account and assign it to a sitio. Leave
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
          <span>Assigned Sitio *</span>
          <select
            value={form.assigned_sitio_id}
            onChange={update('assigned_sitio_id')}
            required
          >
            <option value="" disabled>
              Select a sitio
            </option>
            {sitios.map((sitio) => (
              <option key={sitio.sitio_id} value={sitio.sitio_id}>
                {sitio.sitio_name} (ID {sitio.sitio_id})
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
            required
          />
        </label>

        <label className="create-admin-field">
          <span>First Name *</span>
          <input type="text" value={form.f_name} onChange={update('f_name')} required />
        </label>

        <label className="create-admin-field">
          <span>Middle Name</span>
          <input type="text" value={form.m_name} onChange={update('m_name')} />
        </label>

        <label className="create-admin-field">
          <span>Last Name *</span>
          <input type="text" value={form.l_name} onChange={update('l_name')} required />
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
          <button type="submit" disabled={submitting || sitios.length === 0}>
            {submitting ? 'Creating...' : 'Create Admin'}
          </button>
        </div>
      </form>
    </section>
  )
}
