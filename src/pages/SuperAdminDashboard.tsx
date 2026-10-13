
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

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
  admins?: AdminAccount[]
  sitios?: Sitio[]
  message?: string
}

export function SuperAdminDashboard() {
  const [admins, setAdmins] = useState<AdminAccount[]>([])
  const [sitios, setSitios] = useState<Sitio[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function loadDashboard() {
      setLoading(true)
      setError('')

      try {
        // Get the current authenticated Supabase session.
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

        // Ask the backend to verify the Super Admin and load data.
        const apiBaseUrl =
          import.meta.env.VITE_API_BASE_URL ||
          'http://localhost:3000'

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

        const result =
          (await response.json()) as DashboardResponse

        if (!response.ok) {
          throw new Error(
            result.message || 'Unable to load dashboard data.',
          )
        }

        if (!cancelled) {
          setAdmins(result.admins ?? [])
          setSitios(result.sitios ?? [])
        }
      } catch (err) {
        console.error('Dashboard load failed:', err)

        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : 'Unable to load dashboard data.',
          )
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void loadDashboard()

    return () => {
      cancelled = true
    }
  }, [])

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
            onClick={() => window.location.reload()}
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
                      .filter(Boolean)
                      .join(' ')

                    return (
                      <tr key={admin.uid}>
                        <td>{name || 'Not provided'}</td>
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
                      <td colSpan={4}>
                        No Admin accounts found.
                      </td>
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
