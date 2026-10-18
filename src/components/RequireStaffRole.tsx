import { useEffect, useState, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import {
  dashboardPathFor,
  fetchStaffProfile,
  LOGIN_PATH,
  signOutStaff,
  StaffAccessError,
  type StaffProfile,
  type StaffRole,
} from '../lib/staffProfile'

type GuardState =
  | { status: 'checking' }
  | { status: 'allowed'; profile: StaffProfile }
  | { status: 'redirect'; to: string }
  | { status: 'error'; message: string }

type RequireStaffRoleProps = {
  role: StaffRole
  children: (profile: StaffProfile) => ReactNode
}

// Route guard for the staff dashboards. It sends a signed-out user to the
// shared login page and a signed-in user with a different role to their own
// dashboard. It is a navigation aid only: protected data is enforced by the
// backend and by Row Level Security, not by this component.
export function RequireStaffRole({ role, children }: RequireStaffRoleProps) {
  const [state, setState] = useState<GuardState>({ status: 'checking' })

  useEffect(() => {
    let cancelled = false

    fetchStaffProfile().then(
      (profile) => {
        if (cancelled) return
        if (!profile) setState({ status: 'redirect', to: LOGIN_PATH })
        else if (profile.role !== role) {
          setState({ status: 'redirect', to: dashboardPathFor(profile.role) })
        } else setState({ status: 'allowed', profile })
      },
      (error: unknown) => {
        if (cancelled) return
        if (error instanceof StaffAccessError) {
          // Not a staff account (or suspended): end the session.
          void signOutStaff()
          setState({ status: 'redirect', to: LOGIN_PATH })
          return
        }
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Unable to verify account permissions.',
        })
      },
    )

    return () => {
      cancelled = true
    }
  }, [role])

  if (state.status === 'checking') {
    return <div className="dashboard-message">Checking your account…</div>
  }

  if (state.status === 'redirect') return <Navigate to={state.to} replace />

  if (state.status === 'error') {
    return (
      <div className="dashboard-error" role="alert">
        <h2>Unable to open the dashboard</h2>
        <p>{state.message}</p>
        <p>
          <a href={`${import.meta.env.BASE_URL.replace(/\/$/, '')}${LOGIN_PATH}`}>Return to sign in</a>
        </p>
      </div>
    )
  }

  return <>{children(state.profile)}</>
}
