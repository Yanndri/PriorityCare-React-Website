
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { Icon } from '../components/Icon'
import {
  dashboardPathFor,
  fetchStaffProfile,
  StaffAccessError,
} from '../lib/staffProfile'

// One shared sign-in page for Admin and Super Admin accounts. The role is
// read from public.users after Supabase Auth succeeds; the form never asks
// for it.
export function LoginPage() {
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault()
    setError('')
    setLoading(true)

    try {
      const { data, error: loginError } =
        await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        })

      if (loginError || !data.user) {
        throw new Error('Invalid email or password.')
      }

      let profile
      try {
        profile = await fetchStaffProfile()
      } catch (profileError) {
        await supabase.auth.signOut()
        throw profileError
      }

      if (!profile) {
        await supabase.auth.signOut()
        throw new StaffAccessError('Unable to start your session. Please try again.')
      }

      navigate(dashboardPathFor(profile.role), { replace: true })
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to sign in. Please try again.',
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-hero">
        <div className="meta">§ 00 — Staff portal</div>
        <h1>
          Priority care
          <br />
          for every
          <br />
          resident
        </h1>
        <p className="login-hero-sub">Disaster response, Cebu City</p>
        <ul className="login-facts" aria-label="What the portal covers">
          <li><span>01</span>Resident verification</li>
          <li><span>02</span>Evacuation &amp; shelters</li>
          <li><span>03</span>Rescue dispatch</li>
        </ul>
      </section>

      <form className="login-card" onSubmit={handleLogin}>
        <div className="login-card-head">
          <span className="login-mark" aria-hidden="true">
            <Icon name="life-ring" />
          </span>
          <strong>PRIORITYCARE</strong>
        </div>

        <div className="meta">Sign in</div>
        <h2>Staff login</h2>
        <p className="login-note">
          Admin and Super Admin accounts sign in here. You will be taken to the dashboard for your role.
        </p>

        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />

        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />

        {error && (
          <p role="alert" className="login-error">
            {error}
          </p>
        )}

        <button type="submit" className="primary-button login-submit" disabled={loading}>
          <Icon name="arrow-small-right" />
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  )
}
