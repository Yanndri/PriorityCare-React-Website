
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { CreateAdminForm } from '../components/CreateAdminForm'

type AdminAccount = {
  uid: string
  email: string
  f_name: string | null
  l_name: string | null
  account_status: 'active' | 'suspended'
  assigned_sitio_id: number | null
}

type Sitio = {
  sitio_id: number
  sitio_name: string
}

type DashboardResponse = {
  admins?: unknown
  sitios?: unknown
  message?: string
}

function isAdminAccount(value: unknown): value is AdminAccount {
  if (!value || typeof value !== 'object') return false

  const admin = value as Record<string, unknown>

  return (
    typeof admin.uid === 'string' &&
    typeof admin.email === 'string' &&
    (admin.account_status === 'active' ||
      admin.account_status === 'suspended')
  )
}

function isSitio(value: unknown): value is Sitio {
  if (!value || typeof value !== 'object') return false

  const sitio = value as Record<string, unknown>

  return (
    typeof sitio.sitio_id === 'number' &&
    typeof sitio.sitio_name === 'string'
  )
}

export function SuperAdminDashboard() {
  const [admins, setAdmins] = useState<AdminAccount[]>([])
  const [sitios, setSitios] = useState<Sitio[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadDashboard = useCallback(async () => {
    setLoading(true)
    setError('')

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession()

      if (sessionError) throw sessionError

      if (!session?.access_token) {
        throw new Error(
          'Your session has expired. Please sign in again.',
        )
      }

      const apiBaseUrl = (
        import.meta.env.VITE_API_BASE_URL ||
        'http://localhost:3000'
      ).replace(/\/+$/, '')

      const response = await fetch(
        `${apiBaseUrl}/api/super-admin/dashboard`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            Accept: 'application/json',
          },
        },
      )

      const responseText = await response.text()
      let result: DashboardResponse

      try {
        result = JSON.parse(responseText) as DashboardResponse
      } catch {
        throw new Error(
          `The server returned an invalid response (HTTP ${response.status}). Check the backend.`,
        )
      }

      if (!response.ok) {
        throw new Error(
          result.message ||
            `Unable to load dashboard (HTTP ${response.status}).`,
        )
      }

      if (
        !Array.isArray(result.admins) ||
        !Array.isArray(result.sitios)
      ) {
        console.error(
          'Unexpected dashboard API response structure:',
          result,
        )

        throw new Error(
          'The dashboard API did not return valid admins and sitios arrays. Check the backend response.',
        )
      }

      const validAdmins = result.admins.filter(isAdminAccount)
      const validSitios = result.sitios.filter(isSitio)

      setAdmins(validAdmins)
      setSitios(validSitios)
    } catch (err) {
      console.error('Dashboard load failed:', err)
      setAdmins([])
      setSitios([])

      setError(
        err instanceof Error
          ? err.message
          : 'Unable to load dashboard data.',
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadDashboard()
  }, [loadDashboard])

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
    <main className="super-admin-page">
      <header className="super-admin-header">
        <div>
          <p className="eyebrow">
            PRIORITYCARE / SYSTEM MANAGEMENT
          </p>
          <h1>Super Admin Dashboard</h1>
          <p>
            Manage administrator accounts and sitio assignments.
          </p>
        </div>
      </header>

      {loading && <p>Loading dashboard...</p>}

      {error && (
        <section role="alert" className="dashboard-error">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => void loadDashboard()}
          >
            Retry
          </button>
          {error.toLowerCase().includes('session') && (
            <p>
              Please sign in again using your Super Admin account.
            </p>
          )}
        </section>
      )}

      {!loading && !error && (
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

          <CreateAdminForm
            sitios={sitios}
            onCreated={() => loadDashboard()}
          />

          <section className="super-admin-section">
            <h2>Admin Accounts</h2>
            <p>
              Administrator accounts registered in the system.
            </p>

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

                    const name = [
                      admin.f_name,
                      admin.l_name,
                    ]
                      .filter(
                        (part): part is string =>
                          typeof part === 'string' &&
                          part.trim().length > 0,
                      )
                      .join(' ')

                    return (
                      <tr key={admin.uid}>
                        <td>{name || 'Not provided'}</td>
                        <td>
                          <code className="admin-uid">{admin.uid}</code>
                        </td>
                        <td>{admin.email}</td>
                        <td>
                          {sitio?.sitio_name ?? 'Unassigned'}
                        </td>
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
                      <td colSpan={5}>
                        No Admin accounts found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

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
                              admin.assigned_sitio_id ===
                              sitio.sitio_id,
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
        </>
      )}
    </main>
  )
}
