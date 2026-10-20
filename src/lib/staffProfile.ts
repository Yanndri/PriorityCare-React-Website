import { supabase } from './supabaseClient'

// The signed-in staff member's profile, read from public.users (the
// trusted source of roles). The role is never taken from the login form
// or the URL. These checks only decide where to send the user; the
// backend (requireSuperAdmin) and the database (RLS policies and the
// SECURITY DEFINER functions) enforce what each role may actually do.

export type StaffRole = 'admin' | 'super_admin'

export type StaffProfile = {
  uid: string
  role: StaffRole
  assignedBarangayId: number | null
  fullName: string
  email: string
}

export const LOGIN_PATH = '/login'

export function dashboardPathFor(role: StaffRole) {
  return role === 'super_admin' ? '/super-admin' : '/admin'
}

export class StaffAccessError extends Error {}

type ProfileRow = {
  uid: string
  role: string
  account_status: string
  assigned_barangay_id: number | null
  f_name: string | null
  l_name: string | null
  email: string | null
}

// Returns null when nobody is signed in. Throws StaffAccessError when the
// signed-in account may not use the staff portal.
export async function fetchStaffProfile(): Promise<StaffProfile | null> {
  // getUser() validates the session with Supabase Auth instead of trusting
  // the locally cached session.
  const { data, error: authError } = await supabase.auth.getUser()

  if (authError || !data.user) return null

  const { data: profile, error } = await supabase
    .from('users')
    .select('uid, role, account_status, assigned_barangay_id, f_name, l_name, email')
    .eq('uid', data.user.id)
    .maybeSingle<ProfileRow>()

  if (error) {
    throw new Error(`Unable to verify account permissions: ${error.message}`)
  }

  if (!profile) {
    throw new StaffAccessError(
      'No matching user profile was found. Please contact the administrator.',
    )
  }

  if (profile.account_status !== 'active') {
    throw new StaffAccessError('This account is suspended or inactive.')
  }

  if (profile.role !== 'admin' && profile.role !== 'super_admin') {
    throw new StaffAccessError(
      'This portal is for Admin and Super Admin accounts only.',
    )
  }

  if (profile.role === 'admin' && profile.assigned_barangay_id === null) {
    throw new StaffAccessError(
      'Your account has no assigned barangay. Contact the Super Admin.',
    )
  }

  return {
    uid: profile.uid,
    role: profile.role,
    assignedBarangayId: profile.assigned_barangay_id,
    fullName: [profile.f_name, profile.l_name]
      .filter((part) => part && part.trim())
      .join(' '),
    email: profile.email ?? data.user.email ?? '',
  }
}

export async function signOutStaff() {
  await supabase.auth.signOut()
}
