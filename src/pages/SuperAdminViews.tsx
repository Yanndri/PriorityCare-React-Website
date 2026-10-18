import { useState } from 'react'
import { CreateAdminForm } from '../components/CreateAdminForm'
import {
  updateAdminAccount,
  type AdminAccount,
  type Sitio,
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
  sitios: Sitio[]
}

// System Dashboard summary (shown above the system-wide operational stats)
export function SuperAdminOverview({ admins, sitios }: AccountsData) {
  const activeAdmins = admins.filter(
    (admin) => admin.account_status === 'active',
  ).length

  const suspendedAdmins = admins.filter(
    (admin) => admin.account_status === 'suspended',
  ).length

  const unstaffedSitios = sitios.filter(
    (sitio) =>
      !admins.some(
        (admin) =>
          admin.account_status === 'active' &&
          admin.assigned_sitio_id === sitio.sitio_id,
      ),
  ).length

  return (
    <section className="super-admin-stats" aria-label="Administrator summary">
      <article className="super-admin-card">
        <span>Sitios</span>
        <strong>{sitios.length}</strong>
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
        <span>Sitios without an active Admin</span>
        <strong>{unstaffedSitios}</strong>
      </article>
    </section>
  )
}

// One row of the Admin Accounts table, with its own pending state so one
// slow request does not lock the whole table. Every change is authorized
// again by the backend (requireSuperAdmin).
function AdminAccountRow({
  admin,
  sitios,
  onChanged,
}: {
  admin: AdminAccount
  sitios: Sitio[]
  onChanged: () => Promise<void>
}) {
  const [sitioChoice, setSitioChoice] = useState(
    admin.assigned_sitio_id === null ? '' : String(admin.assigned_sitio_id),
  )
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const sitio = sitios.find(
    (item) => item.sitio_id === admin.assigned_sitio_id,
  )
  const name = adminDisplayName(admin)
  const isActive = admin.account_status === 'active'
  const sitioChanged =
    sitioChoice !== '' && Number(sitioChoice) !== admin.assigned_sitio_id

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
        <div className="admin-sitio-edit">
          <select
            aria-label={`Assigned sitio for ${admin.email}`}
            value={sitioChoice}
            disabled={Boolean(busy)}
            onChange={(event) => setSitioChoice(event.target.value)}
          >
            {admin.assigned_sitio_id === null && (
              <option value="">Unassigned</option>
            )}
            {sitios.map((item) => (
              <option key={item.sitio_id} value={item.sitio_id}>
                {item.sitio_name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="secondary-button"
            disabled={!sitioChanged || Boolean(busy)}
            onClick={() =>
              void apply('Saving…', {
                assigned_sitio_id: Number(sitioChoice),
              })
            }
          >
            Assign
          </button>
        </div>
        <small className="admin-current-sitio">
          Current: {sitio?.sitio_name ?? 'Unassigned'}
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

// Admin Account Management: create, assign sitio, suspend / reactivate
export function SuperAdminAdminAccounts({
  admins,
  sitios,
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
              Assign each Admin to one sitio, or suspend and reactivate
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
        <CreateAdminForm sitios={sitios} onCreated={() => reload()} />
      )}

      <section className="super-admin-section">
        <div className="super-admin-table-wrap">
          <table className="super-admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>User ID</th>
                <th>Email</th>
                <th>Assigned Sitio</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>

            <tbody>
              {admins.map((admin) => (
                <AdminAccountRow
                  key={`${admin.uid}-${admin.account_status}-${admin.assigned_sitio_id}`}
                  admin={admin}
                  sitios={sitios}
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

// Sitio Overview: every sitio, its Admins, and a shortcut to its data
export function SuperAdminSitioOverview({
  admins,
  sitios,
  onOpenSitio,
}: AccountsData & { onOpenSitio: (sitioId: number) => void }) {
  return (
    <section className="super-admin-section">
      <h2>Sitio Overview</h2>
      <p>
        Every registered sitio and its Admins. Open a sitio to limit the
        dashboard modules to that sitio.
      </p>

      <div className="super-admin-table-wrap">
        <table className="super-admin-table">
          <thead>
            <tr>
              <th>Sitio</th>
              <th>Active Admins</th>
              <th>Admin email</th>
              <th>Dashboard</th>
            </tr>
          </thead>

          <tbody>
            {sitios.map((sitio) => {
              const sitioAdmins = admins.filter(
                (admin) =>
                  admin.assigned_sitio_id === sitio.sitio_id &&
                  admin.account_status === 'active',
              )

              return (
                <tr key={sitio.sitio_id}>
                  <td>{sitio.sitio_name}</td>
                  <td>
                    {sitioAdmins.length
                      ? sitioAdmins
                          .map((admin) => adminDisplayName(admin) || admin.email)
                          .join(', ')
                      : 'None'}
                  </td>
                  <td>
                    {sitioAdmins.length
                      ? sitioAdmins.map((admin) => admin.email).join(', ')
                      : '—'}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => onOpenSitio(sitio.sitio_id)}
                    >
                      View this sitio
                    </button>
                  </td>
                </tr>
              )
            })}

            {sitios.length === 0 && (
              <tr>
                <td colSpan={4}>No Sitios found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
