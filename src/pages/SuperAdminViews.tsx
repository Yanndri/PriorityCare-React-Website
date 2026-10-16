import { Link, useOutletContext } from 'react-router-dom'
import { CreateAdminForm } from '../components/CreateAdminForm'
import type {
  AdminAccount,
  SuperAdminOutletContext,
} from './SuperAdminDashboard'

// Views rendered inside SuperAdminDashboard's <Outlet>. They read the
// already-loaded admins/sitios from the outlet context instead of calling
// the API again.

function adminDisplayName(admin: AdminAccount) {
  return [admin.f_name, admin.l_name]
    .filter(
      (part): part is string =>
        typeof part === 'string' && part.trim().length > 0,
    )
    .join(' ')
}

// /super-admin
export function SuperAdminOverview() {
  const { admins, sitios } =
    useOutletContext<SuperAdminOutletContext>()

  const activeAdmins = admins.filter(
    (admin) => admin.account_status === 'active',
  ).length

  const suspendedAdmins = admins.filter(
    (admin) => admin.account_status === 'suspended',
  ).length

  const assignedAdmins = admins.filter(
    (admin) => admin.assigned_sitio_id !== null,
  ).length

  return (
    <>
      <section className="super-admin-stats">
        <article className="super-admin-card">
          <span>Total Admins</span>
          <strong>{admins.length}</strong>
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
          <span>Assigned Admins</span>
          <strong>{assignedAdmins}</strong>
        </article>
      </section>

      <section className="super-admin-section">
        <h2>Quick actions</h2>
        <p>
          {sitios.length} registered sitio
          {sitios.length === 1 ? '' : 's'}.
        </p>

        <div className="super-admin-quick-links">
          <Link to="/super-admin/create-admin">Create Admin</Link>
          <Link to="/super-admin/admins">View Admin Accounts</Link>
          <Link to="/super-admin/sitios">View Sitio Overview</Link>
        </div>
      </section>
    </>
  )
}

// /super-admin/create-admin
export function SuperAdminCreateAdmin() {
  const { sitios, reload } =
    useOutletContext<SuperAdminOutletContext>()

  return (
    <CreateAdminForm
      sitios={sitios}
      onCreated={() => reload()}
    />
  )
}

// /super-admin/admins
export function SuperAdminAdminAccounts() {
  const { admins, sitios } =
    useOutletContext<SuperAdminOutletContext>()

  return (
    <section className="super-admin-section">
      <h2>Admin Accounts</h2>
      <p>Administrator accounts registered in the system.</p>

      <div className="super-admin-table-wrap">
        <table className="super-admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>User ID</th>
              <th>Email</th>
              <th>Assigned Sitio</th>
              <th>Status</th>
            </tr>
          </thead>

          <tbody>
            {admins.map((admin) => {
              const sitio = sitios.find(
                (item) =>
                  item.sitio_id === admin.assigned_sitio_id,
              )

              const name = adminDisplayName(admin)

              return (
                <tr key={admin.uid}>
                  <td>{name || 'Not provided'}</td>
                  <td>
                    <code className="admin-uid">{admin.uid}</code>
                  </td>
                  <td>{admin.email}</td>
                  <td>{sitio?.sitio_name ?? 'Unassigned'}</td>
                  <td>
                    <span
                      className={`account-status ${
                        admin.account_status === 'active'
                          ? 'status-active'
                          : 'status-suspended'
                      }`}
                    >
                      {admin.account_status}
                    </span>
                  </td>
                </tr>
              )
            })}

            {admins.length === 0 && (
              <tr>
                <td colSpan={5}>No Admin accounts found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// /super-admin/sitios
export function SuperAdminSitioOverview() {
  const { admins, sitios } =
    useOutletContext<SuperAdminOutletContext>()

  return (
    <section className="super-admin-section">
      <h2>Sitio Overview</h2>
      <p>Registered Sitios returned by the backend.</p>

      <div className="super-admin-table-wrap">
        <table className="super-admin-table">
          <thead>
            <tr>
              <th>Sitio ID</th>
              <th>Sitio Name</th>
              <th>Assigned Admins</th>
            </tr>
          </thead>

          <tbody>
            {sitios.map((sitio) => (
              <tr key={sitio.sitio_id}>
                <td>{sitio.sitio_id}</td>
                <td>{sitio.sitio_name}</td>
                <td>
                  {
                    admins.filter(
                      (admin) =>
                        admin.assigned_sitio_id === sitio.sitio_id,
                    ).length
                  }
                </td>
              </tr>
            ))}

            {sitios.length === 0 && (
              <tr>
                <td colSpan={3}>No Sitios found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
