import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'

// "Reset PIN" (residents) / "Reset password" (responders) for someone who forgot their login.
// Staff check the person's ID first. The reset-password Edge Function makes a new random
// PIN or password and returns it once; staff hand it over in person, and the person can
// pick their own afterwards in the app (Profile > Change PIN / Change password).
// Who may reset whom is checked by the function: a barangay admin can reset residents of
// their barangay; only the Super Admin can reset responders.
export function ResetLoginButton({ uid, name, kind, className = 'account-button' }: {
  uid: string
  name: string
  kind: 'pin' | 'password'
  className?: string
}) {
  const [busy, setBusy] = useState(false)
  const word = kind === 'pin' ? 'PIN' : 'password'

  async function reset() {
    if (!window.confirm(`Reset the ${word} of ${name}?\n\nCheck their ID first. Their old ${word} stops working right away.`)) return
    setBusy(true)
    try {
      const { data, error } = await supabase.functions.invoke<{ secret?: string; error?: string }>('reset-password', { body: { uid } })
      if (error) {
        const context = (error as { context?: Response }).context
        const detail = context ? await context.json().catch(() => null) : null
        throw new Error(detail?.error || error.message)
      }
      if (!data?.secret) throw new Error(data?.error || 'The reset failed. Try again.')
      window.alert(`New ${word} for ${name}:\n\n${data.secret}\n\nGive it to them in person. They can change it in the app under Profile > Change ${word}.`)
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'The reset failed. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button type="button" className={className} disabled={busy} onClick={() => void reset()}>
      {busy ? 'Resetting…' : `Reset ${word}`}
    </button>
  )
}
