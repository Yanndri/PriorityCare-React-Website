import { supabase } from '../lib/supabaseClient'
import type { TimelineData } from '../utils/auditTrail'

export async function getOperationalTimeline(from: Date, to: Date): Promise<TimelineData> {
  const { data, error } = await supabase.rpc('get_operational_timeline', { p_from: from.toISOString(), p_to: to.toISOString() })
  if (error) {
    throw new Error(error.code === 'PGRST202'
      ? 'Audit trail exports need the 20261014_operational_audit_trail.sql database migration.'
      : error.message)
  }
  return data as TimelineData
}
