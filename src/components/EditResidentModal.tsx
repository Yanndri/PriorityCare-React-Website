import { useEffect, useState } from 'react'
import type { Constraint, Resident, Status } from '../types/dashboard'

type EditResidentModalProps = {
  resident: Resident | null
  isSaving: boolean
  onClose: () => void
  onSave: (residentId: number | string, updates: { name: string; constraint: Constraint; status: Status }) => void
}

export function EditResidentModal({ resident, isSaving, onClose, onSave }: EditResidentModalProps) {
  const [name, setName] = useState('')
  const [constraint, setConstraint] = useState<Constraint>('Walk Assist')
  const [status, setStatus] = useState<Status>('Pending')

  useEffect(() => {
    if (!resident) {
      return
    }

    setName(resident.name)
    setConstraint(resident.constraint)
    setStatus(resident.status)
  }, [resident])

  if (!resident) {
    return null
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <section className="edit-modal">
        <div className="request-modal-header">
          <div>
            <h3>Edit Resident</h3>
            <p>Update the resident record stored in Supabase.</p>
          </div>

          <button className="modal-close-button" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="edit-form-grid">
          <label>
            <span>Full Name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>

          <label>
            <span>Constraint</span>
            <select
              value={constraint}
              onChange={(event) => setConstraint(event.target.value as Constraint)}
            >
              <option value="Bedridden">Bedridden</option>
              <option value="Wheelchair">Wheelchair</option>
              <option value="Visual">Visual</option>
              <option value="Walk Assist">Walk Assist</option>
            </select>
          </label>

          <label>
            <span>Status</span>
            <select value={status} onChange={(event) => setStatus(event.target.value as Status)}>
              <option value="Pending">Pending</option>
              <option value="Verified">Verified</option>
              <option value="Rejected">Rejected</option>
            </select>
          </label>

          <label>
            <span>Sitio</span>
            <input value={resident.sitio} disabled />
          </label>
        </div>

        <div className="request-modal-actions">
          <button className="secondary-button" onClick={onClose}>
            Cancel
          </button>

          <button
            className="verify-button large"
            disabled={isSaving || name.trim().length === 0}
            onClick={() =>
              onSave(resident.id, {
                name: name.trim(),
                constraint,
                status,
              })
            }
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </section>
    </div>
  )
}
