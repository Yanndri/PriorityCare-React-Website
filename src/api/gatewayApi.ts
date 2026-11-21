import { supabase } from '../lib/supabaseClient'

// ESP32 SOS hotspots ("gateways"): pairing, health and commands.
// Database: supabase/migrations/20261118_01_esp32_device_management.sql
// Every call goes through a staff RPC that checks the role: an Admin sees and manages only the
// devices of their assigned barangay, a Super Admin all devices. The device secret is only ever
// returned once, when a device is paired or its secret is replaced; the database keeps a hash.

export type Gateway = {
  gateway_id: string
  name: string
  barangay_id: number | null
  barangay_name: string | null
  active: boolean
  created_at: string
  last_heartbeat_at: string | null
  last_sync_at: string | null
  sta_ip: string | null
  wifi_ssid: string | null
  wifi_rssi: number | null
  firmware_version: string | null
  uptime_s: number | null
  boot_count: number | null
  free_heap: number | null
  storage_used_pct: number | null
  pending_count: number | null
  clients_connected: number | null
  open_commands: number
  reports_total: number
}

export type HotspotReport = {
  report_id: string
  contact_no: string
  alert_type: string
  note: string
  phone_time: string | null
  device_received_at: string | null
  synced_at: string
  result: 'created' | 'already_active' | 'not_registered' | 'rejected'
  reason: string | null
  alert_id: string | null
}

export type GatewaySecret = { gateway_id: string; secret: string }
export type GatewayCommand = 'resync' | 'reboot'

// A device is "online" when its last heartbeat (sent every minute) is under 3 minutes old.
export const ONLINE_WINDOW_MS = 3 * 60 * 1000

function gatewayError(error: { code?: string; message: string }) {
  return new Error(error.code === 'PGRST202'
    ? 'The ESP32 device update has not been installed in the database yet (migration 20261118_01_esp32_device_management.sql).'
    : error.message)
}

export async function listGateways(): Promise<Gateway[]> {
  const { data, error } = await supabase.rpc('list_gateways')
  if (error) throw gatewayError(error)
  return (data ?? []) as Gateway[]
}

export async function listHotspotReports(gatewayId: string, limit = 50): Promise<HotspotReport[]> {
  const { data, error } = await supabase.rpc('list_hotspot_reports', { p_gateway_id: gatewayId, p_limit: limit })
  if (error) throw gatewayError(error)
  return (data ?? []) as HotspotReport[]
}

export async function pairGateway(name: string, barangayId: number | null): Promise<GatewaySecret> {
  const { data, error } = await supabase.rpc('pair_gateway', { p_name: name, p_barangay_id: barangayId })
  if (error) throw gatewayError(error)
  return data as GatewaySecret
}

export async function setGatewayActive(gatewayId: string, active: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_gateway_active', { p_gateway_id: gatewayId, p_active: active })
  if (error) throw gatewayError(error)
}

export async function rotateGatewaySecret(gatewayId: string): Promise<GatewaySecret> {
  const { data, error } = await supabase.rpc('rotate_gateway_secret', { p_gateway_id: gatewayId })
  if (error) throw gatewayError(error)
  return data as GatewaySecret
}

export async function assignGatewayBarangay(gatewayId: string, barangayId: number | null): Promise<void> {
  const { error } = await supabase.rpc('assign_gateway_barangay', { p_gateway_id: gatewayId, p_barangay_id: barangayId })
  if (error) throw gatewayError(error)
}

export async function queueGatewayCommand(gatewayId: string, command: GatewayCommand): Promise<void> {
  const { error } = await supabase.rpc('queue_gateway_command', { p_gateway_id: gatewayId, p_command: command })
  if (error) throw gatewayError(error)
}
