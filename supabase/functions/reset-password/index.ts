// Forgot password / forgot PIN, reset by staff.
// Resident logins use a made-up email built from the contact number, so an email
// reset link can't reach them. Instead staff check the person's ID and press
// "Reset PIN" (residents) or "Reset password" (responders and admins) on the website.
// This function sets a new random PIN or password and returns it once, so staff can
// hand it over in person. The person can then change it in the app.
//
// POST { uid }  ->  { role, secret, kind: 'pin' | 'password' }
// Who may reset whom:
//   resident        <- an active admin of the resident's barangay, or the super admin
//   rescuer, admin  <- the super admin only
//   super admin     <- nobody (use the Supabase dashboard); nobody resets their own login here.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const URL_ = Deno.env.get('SUPABASE_URL')!
const admin = createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// Unbiased random integer in [0, n).
function randomBelow(n: number) {
  const buf = new Uint32Array(1)
  const limit = Math.floor(0x1_0000_0000 / n) * n
  do crypto.getRandomValues(buf); while (buf[0] >= limit)
  return buf[0] % n
}
// 6 digits, never all the same digit or a straight run like 123456.
function newPin() {
  for (;;) {
    const pin = String(randomBelow(1_000_000)).padStart(6, '0')
    if (/^(\d)\1{5}$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) continue
    return pin
  }
}
// 12 characters without look-alikes (0/O, 1/l/I), always with a digit.
function newPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  for (;;) {
    const pw = Array.from({ length: 12 }, () => chars[randomBelow(chars.length)]).join('')
    if (/\d/.test(pw)) return pw
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return reply(405, { error: 'Use POST.' })
  try {
    const header = req.headers.get('authorization') ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : ''
    if (!token) return reply(401, { error: 'Please sign in again.' })
    const { data: me, error: meError } = await admin.auth.getUser(token)
    if (meError || !me.user) return reply(401, { error: 'Your session has expired. Please sign in again.' })

    let body: { uid?: unknown }
    try { body = await req.json() } catch { return reply(400, { error: 'Send { uid } as JSON.' }) }
    const uid = typeof body.uid === 'string' ? body.uid.trim().toLowerCase() : ''
    if (!UUID.test(uid)) return reply(400, { error: 'Invalid account ID.' })
    if (uid === me.user.id) return reply(400, { error: 'You cannot reset your own login here.' })

    const [{ data: actor }, { data: target }] = await Promise.all([
      admin.from('users').select('uid, role, account_status').eq('uid', me.user.id).maybeSingle(),
      admin.from('users').select('uid, role, f_name, l_name').eq('uid', uid).maybeSingle(),
    ])
    if (!actor || actor.account_status !== 'active' || !['admin', 'super_admin'].includes(actor.role)) {
      return reply(403, { error: 'Only an active admin can reset a login.' })
    }
    if (!target) return reply(404, { error: 'Account not found.' })

    if (target.role === 'resident') {
      if (actor.role !== 'super_admin') {
        // Same barangay rule the database uses everywhere, checked as the signed-in admin.
        const asActor = createClient(URL_, Deno.env.get('SUPABASE_ANON_KEY')!, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { persistSession: false, autoRefreshToken: false },
        })
        const { data: allowed, error } = await asActor.rpc('staff_can_access_resident', { p_resident: uid })
        if (error) return reply(500, { error: 'Unable to check your barangay access.' })
        if (!allowed) return reply(403, { error: 'This resident is not in your barangay.' })
      }
    } else if (target.role === 'rescuer' || target.role === 'admin') {
      if (actor.role !== 'super_admin') return reply(403, { error: 'Only the Super Admin can reset staff and responder logins.' })
    } else {
      return reply(403, { error: 'This login cannot be reset here.' })
    }

    const kind = target.role === 'resident' ? 'pin' : 'password'
    const secret = kind === 'pin' ? newPin() : newPassword()
    const { error: updateError } = await admin.auth.admin.updateUserById(uid, { password: secret })
    if (updateError) return reply(500, { error: 'The new PIN or password could not be saved. Try again.' })

    // Audit line in the Edge Function logs (who reset whom; never the secret).
    console.log(JSON.stringify({ event: 'login_reset', actor: me.user.id, actor_role: actor.role, target: uid, target_role: target.role }))
    return reply(200, { role: target.role, kind, secret })
  } catch (e) {
    console.error('reset-password failed:', e instanceof Error ? e.message : e)
    return reply(500, { error: 'The request failed. Please try again.' })
  }
})
