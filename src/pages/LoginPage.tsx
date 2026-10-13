
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

type LoginPageProps = {
  role: 'admin' | 'super_admin'
}

export function LoginPage({ role }: LoginPageProps) {
  const navigate = useNavigate()
  const isSuperAdmin = role === 'super_admin'

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

      const { data: profile, error: profileError } =
        await supabase
          .from('users')
          .select('role, account_status, assigned_sitio_id')
          .eq('uid', data.user.id)
          .maybeSingle()

      if (profileError || !profile) {
        await supabase.auth.signOut()
        throw new Error(
          'No matching user profile was found. Please contact the administrator.',
        )
      }

      if (profile.account_status !== 'active') {
        await supabase.auth.signOut()
        throw new Error('This account is suspended or inactive.')
      }

      if (profile.role !== role) {
        await supabase.auth.signOut()
        throw new Error(
          `This login is for ${isSuperAdmin ? 'Super Admin' : 'Admin'} accounts only.`,
        )
      }

      if (!isSuperAdmin && !profile.assigned_sitio_id) {
        await supabase.auth.signOut()
        throw new Error(
          'Your account has no assigned sitio. Contact the Super Admin.',
        )
      }

      navigate(isSuperAdmin ? '/super-admin' : '/admin')
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
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        background: '#f3f6fa',
        fontFamily: 'Arial, sans-serif',
      }}
    >
      <form
        onSubmit={handleLogin}
        style={{
          width: '100%',
          maxWidth: 400,
          boxSizing: 'border-box',
          padding: 32,
          borderRadius: 16,
          background: '#fff',
          boxShadow: '0 8px 32px rgba(0,0,0,0.08)',
        }}
      >
        <h1 style={{ marginTop: 0, color: '#173b65' }}>
          PriorityCare
        </h1>

        <h2>
          {isSuperAdmin ? 'Super Admin Login' : 'Admin Login'}
        </h2>

        <p style={{ color: '#64748b' }}>
          Sign in using your authorized account.
        </p>

        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          style={inputStyle}
        />

        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          style={inputStyle}
        />

        {error && (
          <p role="alert" style={{ color: '#b91c1c' }}>
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            width: '100%',
            marginTop: 20,
            padding: 12,
            border: 0,
            borderRadius: 8,
            background: '#173b65',
            color: '#fff',
            cursor: loading ? 'wait' : 'pointer',
          }}
        >
          {loading ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </main>
  )
}

const inputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  boxSizing: 'border-box',
  padding: 12,
  margin: '8px 0 18px',
  border: '1px solid #cbd5e1',
  borderRadius: 8,
}
