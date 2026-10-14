
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

async function getAccessToken(): Promise<string> {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession()

  if (error) throw error

  if (!session?.access_token) {
    throw new Error('Please sign in again as Super Admin.')
  }

  return session.access_token
}

async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getAccessToken()

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  })

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
    admins: result.admins as AdminAccount[],
    sitios: result.sitios as Sitio[],
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
