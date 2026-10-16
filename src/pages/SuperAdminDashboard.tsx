
import { useCallback, useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

export type AdminAccount = {
  uid: string
  email: string
  f_name: string | null
  l_name: string | null
  account_status: 'active' | 'suspended'
  assigned_sitio_id: number | null
}

export type Sitio = {
  sitio_id: number
  sitio_name: string
}

// Shared with the nested Super Admin views (see SuperAdminViews.tsx)
// so the dashboard data is loaded once, here, and never re-fetched
// separately by each page.
export type SuperAdminOutletContext = {
  admins: AdminAccount[]
  sitios: Sitio[]
  reload: () => Promise<void>
}

const SUPER_ADMIN_NAV = [
  { to: '/super-admin', label: 'Dashboard', end: true },
  { to: '/super-admin/create-admin', label: 'Create Admin', end: false },
  { to: '/super-admin/admins', label: 'Admin Accounts', end: false },
  { to: '/super-admin/sitios', label: 'Sitio Overview', end: false },
]

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
      admin.account_status === 'suspended') &&
    (admin.f_name === null || typeof admin.f_name === 'string') &&
    (admin.l_name === null || typeof admin.l_name === 'string') &&
    (admin.assigned_sitio_id === null ||
      typeof admin.assigned_sitio_id === 'number')
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
  const [hasLoaded, setHasLoaded] = useState(false)
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
      setHasLoaded(true)
    } catch (err) {
      console.error('Dashboard load failed:', err)

      setAdmins([])
      setSitios([])
      setHasLoaded(false)

      setError(
        err instanceof Error
          ? err.message
          : 'Unable to load dashboard data.',
      )
    } finally {
      setLoading(false)
    }
  }, [])

  // Defer the initial request so state updates do not run
  // synchronously inside the effect body.
  useEffect(() => {
    const timerId = window.setTimeout(() => {
      void loadDashboard()
    }, 0)

    return () => {
      window.clearTimeout(timerId)
    }
  }, [loadDashboard])

  const outletContext: SuperAdminOutletContext = {
    admins,
    sitios,
    reload: loadDashboard,
  }

  return (
    <div className="super-admin-shell">
      <aside
        className="super-admin-sidebar"
        aria-label="Super Admin navigation"
      >
        <div className="brand">
          <span className="brand-mark">P</span>

          <div>
            <strong>PriorityCare</strong>
            <small>Super Admin</small>
          </div>
        </div>

        <nav>
          {SUPER_ADMIN_NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className="nav-button"
            >
              <span className="nav-square" />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

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

        {loading && !hasLoaded && <p>Loading dashboard...</p>}

        {error && (
          <section role="alert" className="dashboard-error">
            <p>{error}</p>

            <button
              type="button"
              onClick={() => void loadDashboard()}
              disabled={loading}
            >
              {loading ? 'Loading...' : 'Retry'}
            </button>

            {error.toLowerCase().includes('session') && (
              <p>
                Please sign in again using your Super Admin account.
              </p>
            )}
          </section>
        )}

        {hasLoaded && !error && (
          <Outlet context={outletContext} />
        )}
      </main>
    </div>
  )
}
