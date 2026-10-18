import { useCallback, useEffect, useState } from 'react'
import {
  getSuperAdminDashboard,
  type AdminAccount,
  type Sitio,
} from '../api/superAdminApi'
import {
  SuperAdminAdminAccounts,
  SuperAdminOverview,
  SuperAdminSitioOverview,
} from './SuperAdminViews'

type SuperAdminSectionProps = {
  view: 'overview' | 'accounts' | 'sitios'
  onOpenSitio: (sitioId: number) => void
}

// Super Admin management content inside the shared dashboard shell.
// Admin accounts are loaded through the backend API (service role, behind
// requireSuperAdmin); they are never read with the browser's Supabase key.
export function SuperAdminSection({ view, onOpenSitio }: SuperAdminSectionProps) {
  const [admins, setAdmins] = useState<AdminAccount[]>([])
  const [sitios, setSitios] = useState<Sitio[]>([])
  const [loading, setLoading] = useState(true)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')

    try {
      const result = await getSuperAdminDashboard()
      setAdmins(result.admins)
      setSitios(result.sitios)
      setHasLoaded(true)
    } catch (err) {
      console.error('Super Admin data failed to load:', err)
      setError(err instanceof Error ? err.message : 'Unable to load Admin accounts.')
    } finally {
      setLoading(false)
    }
  }, [])

  // Defer the first request so state updates do not run synchronously
  // inside the effect body.
  useEffect(() => {
    const timerId = window.setTimeout(() => {
      void load()
    }, 0)

    return () => window.clearTimeout(timerId)
  }, [load])

  if (error) {
    return (
      <section role="alert" className="dashboard-error super-admin-section">
        <p>{error}</p>
        <button type="button" onClick={() => void load()} disabled={loading}>
          {loading ? 'Loading...' : 'Retry'}
        </button>
      </section>
    )
  }

  if (!hasLoaded) return <p role="status">Loading Admin accounts…</p>

  if (view === 'overview') return <SuperAdminOverview admins={admins} sitios={sitios} />

  if (view === 'sitios') {
    return <SuperAdminSitioOverview admins={admins} sitios={sitios} onOpenSitio={onOpenSitio} />
  }

  return <SuperAdminAdminAccounts admins={admins} sitios={sitios} reload={load} />
}
