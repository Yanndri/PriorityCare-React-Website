import { supabase } from '../lib/supabaseClient'
import type { ReconciliationData } from '../utils/reconciliation'
import type { TimelineData } from '../utils/auditTrail'

// Both RPCs already exist in the database. They are SECURITY DEFINER,
// require an active admin/super admin, and scope rows to the caller's
// assigned sitio (super admins: all sitios). Anonymous callers are denied.

function rpcError(error: { code?: string; message: string }, name: string) {
  return new Error(error.code === 'PGRST202'
    ? `The ${name} database function is not installed in this Supabase project.`
    : error.message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function fetchRescueReconciliation(): Promise<ReconciliationData> {
  const { data, error } = await supabase.rpc('get_rescue_reconciliation')
  if (error) throw rpcError(error, 'get_rescue_reconciliation')
  if (!isRecord(data) || !Array.isArray(data.reports) || !Array.isArray(data.residents) || !Array.isArray(data.sitios) || !Array.isArray(data.events)) {
    throw new Error('The reconciliation service returned an unexpected response.')
  }
  return data as unknown as ReconciliationData
}

export async function fetchOperationalTimeline(from: string, to: string): Promise<TimelineData> {
  const { data, error } = await supabase.rpc('get_operational_timeline', { p_from: from, p_to: to })
  if (error) throw rpcError(error, 'get_operational_timeline')
  if (!isRecord(data) || !Array.isArray(data.events) || !Array.isArray(data.sitios)) {
    throw new Error('The audit log service returned an unexpected response.')
  }
  return data as unknown as TimelineData
}
