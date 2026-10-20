import { useCallback, useEffect, useState } from 'react'
import {
  getSuperAdminDashboard,
  type AdminAccount,
  type Barangay,
} from '../api/superAdminApi'
import {
  SuperAdminAdminAccounts,
  SuperAdminOverview,
  SuperAdminBarangayOverview,
} from './SuperAdminViews'

type SuperAdminSectionProps = {
  view: 'overview' | 'accounts' | 'barangays'
  onOpenBarangay: (barangayId: number) => void
}

// Super Admin management content inside the shared dashboard shell.
// Admin accounts are loaded through the backend API (service role, behind
// requireSuperAdmin); they are never read with the browser's Supabase key.
export function SuperAdminSection({ view, onOpenBarangay }: SuperAdminSectionProps) {
  const [admins, setAdmins] = useState<AdminAccount[]>([])
  const [barangays, setBarangays] = useState<Barangay[]>([])
  const [loading, setLoading] = useState(true)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')

    try {
      const result = await getSuperAdminDashboard()
      setAdmins(result.admins)
      setBarangays(result.barangays)
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

  if (view === 'overview') return <SuperAdminOverview admins={admins} barangays={barangays} />

  if (view === 'barangays') {
    return <SuperAdminBarangayOverview admins={admins} barangays={barangays} onOpenBarangay={onOpenBarangay} />
  }

  return <SuperAdminAdminAccounts admins={admins} barangays={barangays} reload={load} />
}
