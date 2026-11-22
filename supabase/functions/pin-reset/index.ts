// Forgot PIN for residents: a one-time code "sent by SMS", then a new PIN.
// Prototype: no SMS provider is connected, so the code comes back in the response and the
// app shows it as a pretend text message. To send real texts later, set SMS_PROVIDER and
// fill in sendSms(); the response then no longer contains the code.
//
// POST { action: 'send', contact }                    -> { ok, masked, expires_in_s, simulated_sms? }
// POST { action: 'verify', contact, code, new_pin }   -> { ok }   (the app then signs in with the new PIN)
// Code rules (expiry, tries, resend wait) live in 20261121_01_pin_reset_codes.sql.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const SMS_PROVIDER = Deno.env.get('SMS_PROVIDER') ?? '' // empty = simulated SMS (prototype)

// Real SMS goes here (e.g. Semaphore or Twilio) once a provider is chosen.
async function sendSms(_to: string, _text: string): Promise<boolean> {
  return false
}

const WEAK_PIN = /^(\d)\1{5}$|^(012345|123456|234567|345678|456789|987654|876543|765432|654321|543210)$/

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return reply(405, { error: 'Use POST.' })
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return reply(400, { error: 'Send JSON.' }) }
  const contact = typeof body.contact === 'string' ? body.contact : ''

  try {
    if (body.action === 'send') {
      const { data, error } = await admin.rpc('request_pin_reset_code', { p_contact: contact })
      if (error) return reply(400, { error: error.message })
      if (!data.ok) return reply(429, { error: data.message, wait_s: data.wait_s })
      const text = `PriorityCare: Your PIN reset code is ${data.code}. It expires in 10 minutes. Do not share it with anyone.`
      if (SMS_PROVIDER) {
        // Real mode: only registered numbers get a text; the answer looks the same either way.
        if (data.registered && !(await sendSms(contact, text))) return reply(502, { error: 'The text could not be sent. Try again.' })
        return reply(200, { ok: true, masked: data.masked, expires_in_s: data.expires_in_s })
      }
      // Simulated mode: no real text goes out, so say plainly when no resident uses the number.
      if (!data.registered) return reply(404, { error: 'No resident account uses this number. Check the number, or register first.' })
      return reply(200, { ok: true, masked: data.masked, expires_in_s: data.expires_in_s, simulated_sms: text })
    }

    if (body.action === 'verify') {
      const pin = typeof body.new_pin === 'string' ? body.new_pin : ''
      if (!/^\d{6}$/.test(pin)) return reply(400, { error: 'The new PIN must be exactly 6 digits.' })
      if (WEAK_PIN.test(pin)) return reply(400, { error: 'Pick a PIN that is harder to guess than a repeat or a straight run.' })
      const { data, error } = await admin.rpc('verify_pin_reset_code', { p_contact: contact, p_code: String(body.code ?? '') })
      if (error) return reply(400, { error: error.message })
      if (!data.ok) return reply(400, { error: data.message })
      const { error: updateError } = await admin.auth.admin.updateUserById(data.uid, { password: pin })
      if (updateError) return reply(500, { error: 'Your new PIN could not be saved. Ask for a new code and try again.' })
      console.log(JSON.stringify({ event: 'pin_reset_by_code', uid: data.uid }))
      return reply(200, { ok: true })
    }

    return reply(400, { error: "action must be 'send' or 'verify'." })
  } catch (e) {
    console.error('pin-reset failed:', e instanceof Error ? e.message : e)
    return reply(500, { error: 'The request failed. Please try again.' })
  }
})
