// Super Admin account management for the website, as a Supabase Edge Function.
// Replaces the separate Node server (prioritycare-api) so the published website
// works without hosting a backend. Same routes and responses as that server:
//   GET   .../api/super-admin/dashboard        admins + barangays
//   POST  .../api/super-admin/admins           create a barangay admin
//   PATCH .../api/super-admin/admins/:uid      suspend / reactivate / reassign
//   POST  .../api/super-admin/rescuers         create an accredited responder
//   PATCH .../api/super-admin/rescuers/:uid    suspend / reactivate / renew accreditation
//   GET   .../api/super-admin/check            authorization test
// Every route requires a signed-in, active super_admin.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, accept',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const SUSPENDED_BAN = '876000h' // effectively permanent until reactivated
const ADMIN_COLUMNS = 'uid, email, f_name, l_name, account_status, assigned_barangay_id'
const bytes = (s: string) => new TextEncoder().encode(s).length

type Body = Record<string, unknown>
type Me = { id: string; email?: string }

async function requireSuperAdmin(req: Request): Promise<Me | Response> {
  const header = req.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) return json(401, { message: 'Authentication required.' })
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) return json(401, { message: 'Invalid or expired session. Please sign in again.' })
  const { data: profile, error: profileError } = await admin.from('users')
    .select('uid, role, account_status').eq('uid', data.user.id).maybeSingle()
  if (profileError) return json(500, { message: 'Unable to verify account permissions.' })
  if (!profile || profile.role !== 'super_admin' || profile.account_status !== 'active') {
    return json(403, { message: 'Active Super Admin access required.' })
  }
  return { id: data.user.id, email: data.user.email }
}

// Shared checks for a new admin or responder account. Returns an error message or the clean values.
function checkPerson(b: Body) {
  const { email, password, f_name, m_name, l_name, contact_no, assigned_barangay_id } = b
  if (typeof email !== 'string' || typeof password !== 'string' || typeof f_name !== 'string' ||
      typeof l_name !== 'string' || typeof contact_no !== 'string' || !email.trim() || !password ||
      !f_name.trim() || !l_name.trim() || !contact_no.trim() ||
      assigned_barangay_id === undefined || assigned_barangay_id === null || assigned_barangay_id === '') {
    return { error: 'Email, password, first name, last name, contact number, and barangay are required.' }
  }
  if (password.length < 8) return { error: 'Password must be at least 8 characters long.' }
  if (bytes(password) > 72) return { error: 'Password must be at most 72 characters long.' }
  if (m_name !== undefined && m_name !== null && typeof m_name !== 'string') return { error: 'Middle name must be text.' }
  if (email.trim().length > 100 || f_name.trim().length > 100 || l_name.trim().length > 100 ||
      (typeof m_name === 'string' && m_name.trim().length > 100) || contact_no.trim().length > 50) {
    return { error: 'Email and names must be at most 100 characters; contact number at most 50.' }
  }
  const digits = contact_no.replace(/\D/g, '')
  if (!/^\+?[0-9][0-9\s-]*$/.test(contact_no.trim()) || digits.length < 7 || digits.length > 15) {
    return { error: 'Contact number must contain 7 to 15 digits (an optional leading +, spaces, and hyphens are allowed).' }
  }
  const barangayId = Number(assigned_barangay_id)
  if ((typeof assigned_barangay_id !== 'number' && typeof assigned_barangay_id !== 'string') ||
      !Number.isSafeInteger(barangayId) || barangayId <= 0) {
    return { error: 'Please select a valid barangay.' }
  }
  const normalizedEmail = email.trim().toLowerCase()
  if (!EMAIL.test(normalizedEmail)) return { error: 'Please enter a valid email address.' }
  return {
    email: normalizedEmail, password, barangayId,
    f_name: f_name.trim(), l_name: l_name.trim(), contact_no: contact_no.trim(),
    m_name: typeof m_name === 'string' && m_name.trim() ? m_name.trim() : null,
  }
}

async function barangayExists(id: number): Promise<Response | null> {
  const { data, error } = await admin.from('barangays').select('barangay_id').eq('barangay_id', id).maybeSingle()
  if (error) return json(500, { message: 'Unable to verify the selected barangay.' })
  if (!data) return json(400, { message: 'The selected barangay does not exist.' })
  return null
}

function parseIsoDate(value: unknown) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return null
  const d = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value ? null : value
}

function validateAccreditation(b: Body) {
  const { accreditation_no, organization, accredited_on, valid_until } = b
  if (typeof accreditation_no !== 'string' || accreditation_no.trim().length < 3 || accreditation_no.trim().length > 50) {
    return 'Accreditation number must be 3 to 50 characters.'
  }
  if (typeof organization !== 'string' || organization.trim().length < 2 || organization.trim().length > 150) {
    return 'Enter the organization that fields this responder (2 to 150 characters).'
  }
  const from = parseIsoDate(accredited_on)
  const until = parseIsoDate(valid_until)
  if (!from || !until) return 'Accreditation dates must be valid dates (YYYY-MM-DD).'
  if (until <= from) return 'The accreditation must expire after the date it was issued.'
  return null
}

function rosterDetails(b: Body) {
  const list = b.trainings === undefined || b.trainings === null ? [] : b.trainings
  if (!Array.isArray(list) || list.length > 20 ||
      list.some((t) => typeof t !== 'string' || !t.trim() || t.trim().length > 100)) {
    return { error: 'List up to 20 trainings, each at most 100 characters.' }
  }
  const ins = b.insurance_ref
  if (ins !== undefined && ins !== null && (typeof ins !== 'string' || ins.trim().length > 100)) {
    return { error: 'Insurance reference must be at most 100 characters.' }
  }
  return {
    trainings: [...new Set((list as string[]).map((t) => t.trim()))],
    insurance_ref: typeof ins === 'string' && ins.trim() ? ins.trim() : null,
  }
}

async function dashboard() {
  const [admins, barangays] = await Promise.all([
    admin.from('users').select(ADMIN_COLUMNS).eq('role', 'admin').order('email'),
    admin.from('barangays').select('barangay_id, barangay_name').order('barangay_name'),
  ])
  if (admins.error) return json(500, { message: 'Unable to load administrator accounts.' })
  if (barangays.error) return json(500, { message: 'Unable to load barangays.' })
  return json(200, { admins: admins.data ?? [], barangays: barangays.data ?? [] })
}

async function createAdmin(b: Body) {
  const p = checkPerson(b)
  if ('error' in p) return json(400, { message: p.error })
  let requestedUid: string | null = null
  if (b.uid !== undefined && b.uid !== null && b.uid !== '') {
    if (typeof b.uid !== 'string' || !UUID.test(b.uid.trim())) {
      return json(400, { message: 'User ID must be a valid UUID (e.g. 123e4567-e89b-12d3-a456-426614174000), or left blank to auto-generate.' })
    }
    requestedUid = b.uid.trim().toLowerCase()
    const { data, error } = await admin.from('users').select('uid').eq('uid', requestedUid).maybeSingle()
    if (error) return json(500, { message: 'Unable to verify the User ID.' })
    if (data) return json(409, { message: 'An account with this User ID already exists.' })
  }
  const missing = await barangayExists(p.barangayId)
  if (missing) return missing
  const byEmail = await admin.from('users').select('uid').eq('email', p.email).maybeSingle()
  if (byEmail.error) return json(500, { message: 'Unable to verify the email address.' })
  if (byEmail.data) return json(409, { message: 'An account with this email already exists.' })
  const byContact = await admin.from('users').select('uid').eq('contact_no', p.contact_no).maybeSingle()
  if (byContact.error) return json(500, { message: 'Unable to verify the contact number.' })
  if (byContact.data) return json(409, { message: 'An account with this contact number already exists.' })

  const { data: auth, error: authError } = await admin.auth.admin.createUser({
    email: p.email, password: p.password, email_confirm: true, ...(requestedUid ? { id: requestedUid } : {}),
  })
  if (authError || !auth.user) {
    if (authError?.code === 'email_exists') return json(409, { message: 'An account with this email already exists.' })
    return json(400, { message: authError?.message || 'Unable to create the Auth account.' })
  }
  const { data: profile, error: profileError } = await admin.from('users').insert({
    uid: auth.user.id, role: 'admin', email: p.email, f_name: p.f_name, m_name: p.m_name, l_name: p.l_name,
    contact_no: p.contact_no, assigned_barangay_id: p.barangayId, account_status: 'active', is_verified: false,
  }).select(ADMIN_COLUMNS).single()
  if (profileError) {
    await admin.auth.admin.deleteUser(auth.user.id)
    if (profileError.code === '23505') {
      return json(409, { message: 'An account with this email, contact number, or User ID already exists.' })
    }
    return json(500, { message: 'The Admin profile could not be created. Check the database constraints and try again.' })
  }
  return json(201, { message: 'Admin account created successfully.', admin: profile })
}

async function updateAdmin(me: Me, uidRaw: string, b: Body) {
  const uid = uidRaw.trim().toLowerCase()
  if (!UUID.test(uid)) return json(400, { message: 'Invalid Admin account ID.' })
  if (uid === me.id.toLowerCase()) return json(400, { message: 'You cannot change your own account here.' })
  if (!b || typeof b !== 'object' || Array.isArray(b)) return json(400, { message: 'Invalid request body.' })
  const keys = Object.keys(b)
  if (!keys.length || keys.some((k) => !['account_status', 'assigned_barangay_id'].includes(k))) {
    return json(400, { message: 'Send account_status and/or assigned_barangay_id only.' })
  }
  const changes: Record<string, unknown> = {}
  if (b.account_status !== undefined) {
    if (b.account_status !== 'active' && b.account_status !== 'suspended') {
      return json(400, { message: "Status must be 'active' or 'suspended'." })
    }
    changes.account_status = b.account_status
  }
  if (b.assigned_barangay_id !== undefined) {
    const id = Number(b.assigned_barangay_id)
    if ((typeof b.assigned_barangay_id !== 'number' && typeof b.assigned_barangay_id !== 'string') ||
        !Number.isSafeInteger(id) || id <= 0) {
      return json(400, { message: 'Please select a valid barangay.' })
    }
    const missing = await barangayExists(id)
    if (missing) return missing
    changes.assigned_barangay_id = id
  }
  const { data: target, error: targetError } = await admin.from('users')
    .select('uid, role, account_status, assigned_barangay_id').eq('uid', uid).maybeSingle()
  if (targetError) return json(500, { message: 'Unable to load the Admin account.' })
  if (!target || target.role !== 'admin') return json(404, { message: 'Admin account not found.' })

  const { data: updated, error: updateError } = await admin.from('users').update(changes)
    .eq('uid', uid).eq('role', 'admin').select(ADMIN_COLUMNS).single()
  if (updateError || !updated) return json(500, { message: 'Unable to update the Admin account.' })

  if (changes.account_status && changes.account_status !== target.account_status) {
    const { error: banError } = await admin.auth.admin.updateUserById(uid, {
      ban_duration: changes.account_status === 'suspended' ? SUSPENDED_BAN : 'none',
    })
    if (banError) {
      await admin.from('users').update({
        account_status: target.account_status, assigned_barangay_id: target.assigned_barangay_id,
      }).eq('uid', uid)
      return json(500, { message: 'Unable to update sign-in access for this Admin. No change was saved.' })
    }
  }
  const verb = changes.account_status === 'suspended' ? 'suspended'
    : changes.account_status === 'active' && target.account_status !== 'active' ? 'reactivated' : 'updated'
  return json(200, { message: `Admin account ${verb}.`, admin: updated })
}

async function createRescuer(me: Me, b: Body) {
  const p = checkPerson(b)
  if ('error' in p) return json(400, { message: p.error })
  const accreditationError = validateAccreditation(b)
  if (accreditationError) return json(400, { message: accreditationError })
  const roster = rosterDetails(b)
  if ('error' in roster) return json(400, { message: roster.error })
  const missing = await barangayExists(p.barangayId)
  if (missing) return missing

  const { data: auth, error: authError } = await admin.auth.admin.createUser({
    email: p.email, password: p.password, email_confirm: true,
  })
  if (authError || !auth.user) {
    if (authError?.code === 'email_exists') return json(409, { message: 'An account with this email already exists.' })
    return json(400, { message: authError?.message || 'Unable to create the Auth account.' })
  }
  const uid = auth.user.id
  const { error: profileError } = await admin.from('users').insert({
    uid, role: 'rescuer', email: p.email, f_name: p.f_name, m_name: p.m_name, l_name: p.l_name,
    contact_no: p.contact_no, assigned_barangay_id: p.barangayId, account_status: 'active', is_verified: true,
  })
  if (profileError) {
    await admin.auth.admin.deleteUser(uid)
    return json(profileError.code === '23505' ? 409 : 500, {
      message: profileError.code === '23505'
        ? 'An account with this email or contact number already exists.'
        : 'The responder profile could not be created.',
    })
  }
  const { error: accError } = await admin.from('responder_accreditations').insert({
    uid, accreditation_no: String(b.accreditation_no).trim(), organization: String(b.organization).trim(),
    accredited_on: b.accredited_on, valid_until: b.valid_until,
    trainings: roster.trainings, insurance_ref: roster.insurance_ref, updated_by: me.id,
  })
  if (accError) {
    await admin.auth.admin.deleteUser(uid) // cascades to public.users
    return json(accError.code === '23505' ? 409 : 500, {
      message: accError.code === '23505'
        ? 'This accreditation number is already registered to another responder.'
        : 'The accreditation record could not be saved.',
    })
  }
  return json(201, { message: 'Responder account created.', rescuer: { uid, email: p.email } })
}

async function updateRescuer(me: Me, uidRaw: string, b: Body) {
  const uid = uidRaw.trim().toLowerCase()
  if (!UUID.test(uid)) return json(400, { message: 'Invalid responder account ID.' })
  const { data: target, error: targetError } = await admin.from('users').select('uid, role').eq('uid', uid).maybeSingle()
  if (targetError) return json(500, { message: 'Unable to find the responder.' })
  if (!target || target.role !== 'rescuer') return json(404, { message: 'Responder account not found.' })

  if (b.account_status !== undefined) {
    if (b.account_status !== 'active' && b.account_status !== 'suspended') {
      return json(400, { message: 'Invalid account status.' })
    }
    const { error } = await admin.from('users').update({ account_status: b.account_status }).eq('uid', uid)
    if (error) return json(500, { message: 'Unable to update the account status.' })
    const { error: banError } = await admin.auth.admin.updateUserById(uid, {
      ban_duration: b.account_status === 'suspended' ? SUSPENDED_BAN : 'none',
    })
    if (banError) return json(500, { message: 'The status was saved, but signing in could not be updated. Try again.' })
  }
  if (b.valid_until !== undefined) {
    const accreditationError = validateAccreditation(b)
    if (accreditationError) return json(400, { message: accreditationError })
    const roster = rosterDetails(b)
    if ('error' in roster) return json(400, { message: roster.error })
    const { error } = await admin.from('responder_accreditations').upsert({
      uid, accreditation_no: String(b.accreditation_no).trim(), organization: String(b.organization).trim(),
      accredited_on: b.accredited_on, valid_until: b.valid_until, trainings: roster.trainings,
      insurance_ref: roster.insurance_ref, updated_at: new Date().toISOString(), updated_by: me.id,
    })
    if (error) {
      return json(error.code === '23505' ? 409 : 500, {
        message: error.code === '23505'
          ? 'This accreditation number is already registered to another responder.'
          : 'Unable to save the accreditation.',
      })
    }
  }
  return json(200, { message: 'Responder updated.' })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const path = new URL(req.url).pathname.replace(/\/+$/, '')
    const route = path.slice(path.indexOf('/api/super-admin') + '/api/super-admin'.length)
    if (!path.includes('/api/super-admin')) return json(404, { message: 'Not found.' })

    const me = await requireSuperAdmin(req)
    if (me instanceof Response) return me

    let body: Body = {}
    if (req.method === 'POST' || req.method === 'PATCH') {
      try { body = await req.json() } catch { return json(400, { message: 'Invalid JSON body.' }) }
    }
    const one = (prefix: string) => route.startsWith(prefix + '/') ? decodeURIComponent(route.slice(prefix.length + 1)) : null

    if (req.method === 'GET' && route === '/dashboard') return await dashboard()
    if (req.method === 'GET' && route === '/check') {
      return json(200, { message: 'Super Admin authorization successful.', userId: me.id, email: me.email })
    }
    if (req.method === 'POST' && route === '/admins') return await createAdmin(body)
    if (req.method === 'PATCH' && one('/admins')) return await updateAdmin(me, one('/admins')!, body)
    if (req.method === 'POST' && route === '/rescuers') return await createRescuer(me, body)
    if (req.method === 'PATCH' && one('/rescuers')) return await updateRescuer(me, one('/rescuers')!, body)
    return json(404, { message: 'Not found.' })
  } catch (error) {
    console.error('super-admin failed:', error instanceof Error ? error.message : error)
    return json(500, { message: 'The request failed. Please try again.' })
  }
})
