import { useState } from 'react'
import { CreateAdminForm } from '../components/CreateAdminForm'
import {
  updateAdminAccount,
  type AdminAccount,
  type Barangay,
} from '../api/superAdminApi'

// Super Admin-only views rendered inside the shared dashboard shell
// (App.tsx). The data comes from the backend API, which re-checks that the
// caller is an active Super Admin before returning anything.

function adminDisplayName(admin: AdminAccount) {
  return [admin.f_name, admin.l_name]
    .filter(
      (part): part is string =>
        typeof part === 'string' && part.trim().length > 0,
    )
    .join(' ')
}

type AccountsData = {
  admins: AdminAccount[]
  barangays: Barangay[]
}

// System Dashboard summary (shown above the system-wide operational stats)
export function SuperAdminOverview({ admins, barangays }: AccountsData) {
  const activeAdmins = admins.filter(
    (admin) => admin.account_status === 'active',
  ).length

  const suspendedAdmins = admins.filter(
    (admin) => admin.account_status === 'suspended',
  ).length

  const unstaffedBarangays = barangays.filter(
    (barangay) =>
      !admins.some(
        (admin) =>
          admin.account_status === 'active' &&
          admin.assigned_barangay_id === barangay.barangay_id,
      ),
  ).length

  return (
    <section className="super-admin-stats" aria-label="Administrator summary">
      <article className="super-admin-card">
        <span>Barangays</span>
        <strong>{barangays.length}</strong>
      </article>

      <article className="super-admin-card">
        <span>Active Admins</span>
        <strong>{activeAdmins}</strong>
      </article>

      <article className="super-admin-card">
        <span>Suspended Admins</span>
        <strong>{suspendedAdmins}</strong>
      </article>

      <article className="super-admin-card">
        <span>Barangays without an active Admin</span>
        <strong>{unstaffedBarangays}</strong>
      </article>
    </section>
  )
}

// One row of the Admin Accounts table, with its own pending state so one
// slow request does not lock the whole table. Every change is authorized
// again by the backend (requireSuperAdmin).
function AdminAccountRow({
  admin,
  barangays,
  onChanged,
}: {
  admin: AdminAccount
  barangays: Barangay[]
  onChanged: () => Promise<void>
}) {
  const [barangayChoice, setBarangayChoice] = useState(
    admin.assigned_barangay_id === null ? '' : String(admin.assigned_barangay_id),
  )
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const barangay = barangays.find(
    (item) => item.barangay_id === admin.assigned_barangay_id,
  )
  const name = adminDisplayName(admin)
  const isActive = admin.account_status === 'active'
  const barangayChanged =
    barangayChoice !== '' && Number(barangayChoice) !== admin.assigned_barangay_id

  async function apply(
    label: string,
    changes: Parameters<typeof updateAdminAccount>[1],
  ) {
    setBusy(label)
    setError('')
    setMessage('')

    try {
      const result = await updateAdminAccount(admin.uid, changes)
      setMessage(result.message ?? 'Saved.')
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed.')
    } finally {
      setBusy('')
    }
  }

  function toggleStatus() {
    const next = isActive ? 'suspended' : 'active'
    const prompt = isActive
      ? `Suspend ${name || admin.email}? They will be signed out and lose access until reactivated.`
      : `Reactivate ${name || admin.email}?`

    if (!window.confirm(prompt)) return

    void apply(isActive ? 'Suspending…' : 'Reactivating…', {
      account_status: next,
    })
  }

  return (
    <tr>
      <td>{name || 'Not provided'}</td>
      <td>
        <code className="admin-uid">{admin.uid}</code>
      </td>
      <td>{admin.email}</td>
      <td>
        <div className="admin-barangay-edit">
          <select
            aria-label={`Assigned barangay for ${admin.email}`}
            value={barangayChoice}
            disabled={Boolean(busy)}
            onChange={(event) => setBarangayChoice(event.target.value)}
          >
            {admin.assigned_barangay_id === null && (
              <option value="">Unassigned</option>
            )}
            {barangays.map((item) => (
              <option key={item.barangay_id} value={item.barangay_id}>
                {item.barangay_name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="secondary-button"
            disabled={!barangayChanged || Boolean(busy)}
            onClick={() =>
              void apply('Saving…', {
                assigned_barangay_id: Number(barangayChoice),
              })
            }
          >
            Assign
          </button>
        </div>
        <small className="admin-current-barangay">
          Current: {barangay?.barangay_name ?? 'Unassigned'}
        </small>
      </td>
      <td>
        <span
          className={`account-status ${
            isActive ? 'status-active' : 'status-suspended'
          }`}
        >
          {admin.account_status}
        </span>
      </td>
      <td>
        <button
          type="button"
          className={isActive ? 'danger-button' : 'secondary-button'}
          disabled={Boolean(busy)}
          onClick={toggleStatus}
        >
          {isActive ? 'Suspend' : 'Reactivate'}
        </button>
        {busy && <small role="status">{busy}</small>}
        {message && !busy && <small role="status">{message}</small>}
        {error && (
          <small role="alert" className="admin-row-error">
            {error}
          </small>
        )}
      </td>
    </tr>
  )
}

// Admin Account Management: create, assign barangay, suspend / reactivate
export function SuperAdminAdminAccounts({
  admins,
  barangays,
  reload,
}: AccountsData & { reload: () => Promise<void> }) {
  const [showCreate, setShowCreate] = useState(false)

  return (
    <>
      <section className="super-admin-section">
        <div className="section-header">
          <div>
            <h2>Admin Accounts</h2>
            <p>
              Assign each Admin to one barangay, or suspend and reactivate
              accounts. Super Admin accounts are not listed and cannot be
              changed here.
            </p>
          </div>
          <button
            type="button"
            className="verify-button"
            aria-expanded={showCreate}
            onClick={() => setShowCreate((open) => !open)}
          >
            {showCreate ? 'Close form' : 'Create Admin'}
          </button>
        </div>
      </section>

      {showCreate && (
        <CreateAdminForm barangays={barangays} onCreated={() => reload()} />
      )}

      <section className="super-admin-section">
        <div className="super-admin-table-wrap">
          <table className="super-admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>User ID</th>
                <th>Email</th>
                <th>Assigned Barangay</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>

            <tbody>
              {admins.map((admin) => (
                <AdminAccountRow
                  key={`${admin.uid}-${admin.account_status}-${admin.assigned_barangay_id}`}
                  admin={admin}
                  barangays={barangays}
                  onChanged={reload}
                />
              ))}

              {admins.length === 0 && (
                <tr>
                  <td colSpan={6}>No Admin accounts found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}

// Barangay Overview: every barangay, its Admins, and a shortcut to its data
export function SuperAdminBarangayOverview({
  admins,
  barangays,
  onOpenBarangay,
}: AccountsData & { onOpenBarangay: (barangayId: number) => void }) {
  return (
    <section className="super-admin-section">
      <h2>Barangay Overview</h2>
      <p>
        Every registered barangay and its Admins. Open a barangay to limit the
        dashboard modules to that barangay.
      </p>

      <div className="super-admin-table-wrap">
        <table className="super-admin-table">
          <thead>
            <tr>
              <th>Barangay</th>
              <th>Active Admins</th>
              <th>Admin email</th>
              <th>Dashboard</th>
            </tr>
          </thead>

          <tbody>
            {barangays.map((barangay) => {
              const barangayAdmins = admins.filter(
                (admin) =>
                  admin.assigned_barangay_id === barangay.barangay_id &&
                  admin.account_status === 'active',
              )

              return (
                <tr key={barangay.barangay_id}>
                  <td>{barangay.barangay_name}</td>
                  <td>
                    {barangayAdmins.length
                      ? barangayAdmins
                          .map((admin) => adminDisplayName(admin) || admin.email)
                          .join(', ')
                      : 'None'}
                  </td>
                  <td>
                    {barangayAdmins.length
                      ? barangayAdmins.map((admin) => admin.email).join(', ')
                      : '—'}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => onOpenBarangay(barangay.barangay_id)}
                    >
                      View this barangay
                    </button>
                  </td>
                </tr>
              )
            })}

            {barangays.length === 0 && (
              <tr>
                <td colSpan={4}>No Barangays found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
