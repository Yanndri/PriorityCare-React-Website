
import { supabase } from '../lib/supabaseClient'

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'
).replace(/\/+$/, '')

export type AdminAccount = {
  uid: string
  email: string
  f_name: string | null
  l_name: string | null
  account_status: 'active' | 'suspended'
  assigned_sitio_id: number | null
}

export type Sitio = {
  sitio_id: number
  sitio_name: string
}

export type DashboardData = {
  admins: AdminAccount[]
  sitios: Sitio[]
}

export type CreateAdminInput = {
  email: string
  password: string
  f_name: string
  m_name?: string
  l_name: string
  contact_no: string
  assigned_sitio_id: number
  /** Optional custom User ID (UUID). Leave blank to auto-generate. */
  uid?: string
}

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Returns a current access token, refreshing it first when it has expired
// or is about to, so the backend never receives a stale JWT.
async function getAccessToken(forceRefresh = false): Promise<string> {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession()

  if (error) throw error

  if (!session?.access_token) {
    throw new Error('Your session has ended. Please sign in again.')
  }

  const expiresSoon =
    typeof session.expires_at === 'number' &&
    session.expires_at * 1000 - Date.now() < 60_000

  if (!forceRefresh && !expiresSoon) return session.access_token

  const { data: refreshed, error: refreshError } =
    await supabase.auth.refreshSession()

  if (refreshError || !refreshed.session?.access_token) {
    throw new Error('Your session has expired. Please sign in again.')
  }

  return refreshed.session.access_token
}

async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const send = async (token: string) => fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  })

  let response: Response

  try {
    response = await send(await getAccessToken())

    // A 401 can mean the token expired in transit: refresh once and retry.
    if (response.status === 401) {
      response = await send(await getAccessToken(true))
    }
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(
        `Cannot reach the PriorityCare API at ${API_BASE_URL}. Make sure the backend is running.`,
        { cause: error },
      )
    }
    throw error
  }

  const text = await response.text()

  let result: Record<string, unknown> = {}

  if (text) {
    try {
      result = JSON.parse(text) as Record<string, unknown>
    } catch {
      throw new Error(
        `The server returned an invalid response (HTTP ${response.status}).`,
      )
    }
  }

  if (!response.ok) {
    throw new Error(
      typeof result.message === 'string'
        ? result.message
        : `Request failed (HTTP ${response.status}).`,
    )
  }

  return result as T
}

function isAdminAccount(value: unknown): value is AdminAccount {
  if (!value || typeof value !== 'object') return false

  const admin = value as Record<string, unknown>

  return (
    typeof admin.uid === 'string' &&
    typeof admin.email === 'string' &&
    (admin.account_status === 'active' ||
      admin.account_status === 'suspended') &&
    (admin.f_name === null || typeof admin.f_name === 'string') &&
    (admin.l_name === null || typeof admin.l_name === 'string') &&
    (admin.assigned_sitio_id === null ||
      typeof admin.assigned_sitio_id === 'number')
  )
}

function isSitio(value: unknown): value is Sitio {
  if (!value || typeof value !== 'object') return false

  const sitio = value as Record<string, unknown>

  return (
    typeof sitio.sitio_id === 'number' &&
    typeof sitio.sitio_name === 'string'
  )
}

export async function getSuperAdminDashboard(): Promise<DashboardData> {
  const result = await apiRequest<{
    admins?: unknown
    sitios?: unknown
  }>('/api/super-admin/dashboard')

  if (!Array.isArray(result.admins) || !Array.isArray(result.sitios)) {
    throw new Error(
      'Invalid dashboard response: expected admins and sitios arrays.',
    )
  }

  return {
    admins: result.admins.filter(isAdminAccount),
    sitios: result.sitios.filter(isSitio),
  }
}

export async function createAdmin(
  input: CreateAdminInput,
): Promise<{ message?: string; admin?: AdminAccount }> {
  if (!input.email.trim() || !input.password) {
    throw new Error('Email and password are required.')
  }

  if (
    !Number.isInteger(input.assigned_sitio_id) ||
    input.assigned_sitio_id <= 0
  ) {
    throw new Error('Please select a valid Sitio.')
  }

  const uid = input.uid?.trim()

  if (uid && !UUID_PATTERN.test(uid)) {
    throw new Error(
      'User ID must be a valid UUID, or left blank to auto-generate.',
    )
  }

  return apiRequest<{ message?: string; admin?: AdminAccount }>(
    '/api/super-admin/admins',
    {
      method: 'POST',
      body: JSON.stringify({ ...input, uid: uid || undefined }),
    },
  )
}

export type AdminAccountUpdate = {
  account_status?: 'active' | 'suspended'
  assigned_sitio_id?: number
}

// Suspend, reactivate, or reassign an Admin account (Super Admin only;
// enforced by the backend).
export async function updateAdminAccount(
  uid: string,
  changes: AdminAccountUpdate,
): Promise<{ message?: string; admin?: AdminAccount }> {
  if (!UUID_PATTERN.test(uid)) {
    throw new Error('Invalid Admin account ID.')
  }

  if (
    changes.assigned_sitio_id !== undefined &&
    (!Number.isInteger(changes.assigned_sitio_id) ||
      changes.assigned_sitio_id <= 0)
  ) {
    throw new Error('Please select a valid Sitio.')
  }

  return apiRequest<{ message?: string; admin?: AdminAccount }>(
    `/api/super-admin/admins/${encodeURIComponent(uid)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(changes),
    },
  )
}
