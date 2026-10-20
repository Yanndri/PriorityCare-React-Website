// Resident self-registration for the PriorityCare app.
// Creates a confirmed Auth login (email derived from the contact number,
// password = the resident's 6-digit PIN), then writes the resident's rows
// with complete_resident_registration. If that fails the login is removed,
// so a rejected form can be fixed and sent again.
//
// Body: { pin: "123456", ...form } where form is what
// complete_resident_registration expects (see 20261019_05 migration).
// Response: { uid, household_id, email } or { error }.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return reply(405, { error: 'Use POST.' })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return reply(400, { error: 'Send the registration as JSON.' })
  }
  const { pin, ...form } = body
  if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) return reply(400, { error: 'The PIN must be 6 digits.' })

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: email, error: emailError } = await admin.rpc('resident_login_email', { p_contact: form.contact_no ?? '' })
  if (emailError) return reply(500, { error: emailError.message })
  if (!/^09\d{9}@/.test(email)) return reply(400, { error: 'Enter a mobile number like 09171234567.' })

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email, password: pin, email_confirm: true, user_metadata: { role: 'resident' },
  })
  if (createError || !created.user) {
    const taken = createError?.message?.toLowerCase().includes('already')
    return reply(taken ? 409 : 400, {
      error: taken ? 'This contact number is already registered.' : createError?.message ?? 'Could not create the login.',
    })
  }

  const { data: result, error: registerError } = await admin.rpc('complete_resident_registration', {
    p_uid: created.user.id, p: form,
  })
  if (registerError) {
    await admin.auth.admin.deleteUser(created.user.id)
    return reply(400, { error: registerError.message })
  }
  return reply(200, result)
})
