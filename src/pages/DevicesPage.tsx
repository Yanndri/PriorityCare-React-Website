import { useCallback, useEffect, useState, type FormEvent, type SyntheticEvent } from 'react'
import {
  assignGatewayBarangay,
  listGateways,
  listHotspotReports,
  ONLINE_WINDOW_MS,
  pairGateway,
  queueGatewayCommand,
  rotateGatewaySecret,
  setGatewayActive,
  type Gateway,
  type GatewayCommand,
  type GatewaySecret,
  type HotspotReport,
} from '../api/gatewayApi'
import { useLiveSignal } from '../lib/useLiveSignal'

// ESP32 Devices: the SOS hotspots that residents with no load connect to.
// Admin: devices of the assigned barangay. Super Admin: all devices, or the barangay in the scope.
// The dashboard never talks to the ESP32 directly (a browser can't reach a device on the hall
// WiFi from an https page). The device reports here every minute through PriorityCare, and picks
// up commands (send now, restart) on its next report. The local console link opens the device's
// own page, which only works on the same WiFi as the device.

type DevicesPageProps = {
  isSuperAdmin: boolean
  scopeBarangayId: number | null
  barangayOptions?: { barangay_id: number; barangay_name: string }[]
}

type DeviceState = 'online' | 'offline' | 'disconnected' | 'never'

function deviceState(g: Gateway, now: number): DeviceState {
  if (!g.active) return 'disconnected'
  if (!g.last_heartbeat_at) return 'never'
  return now - new Date(g.last_heartbeat_at).getTime() < ONLINE_WINDOW_MS ? 'online' : 'offline'
}

const stateLabel: Record<DeviceState, string> = {
  online: 'Online',
  offline: 'Offline',
  disconnected: 'Disconnected',
  never: 'Waiting for first contact',
}
const stateClass: Record<DeviceState, string> = {
  online: 'evac-open',
  offline: 'evac-full',
  disconnected: 'evac-closed',
  never: 'evac-closed',
}

function ago(iso: string | null, now: number) {
  if (!iso) return 'Never'
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 90) return `${s} seconds ago`
  if (s < 5400) return `${Math.round(s / 60)} minutes ago`
  if (s < 172800) return `${Math.round(s / 3600)} hours ago`
  return new Date(iso).toLocaleString()
}

function signal(rssi: number | null) {
  if (rssi == null) return ''
  const word = rssi >= -60 ? 'strong' : rssi >= -72 ? 'fair' : 'weak'
  return ` (${word} signal, ${rssi} dBm)`
}

function uptime(s: number | null) {
  if (s == null) return 'unknown'
  const h = Math.floor(s / 3600)
  return h >= 48 ? `${Math.floor(h / 24)} days` : `${h} h ${Math.floor((s % 3600) / 60)} min`
}

// Health in one line: problems first, otherwise "Good".
function health(g: Gateway) {
  const issues: string[] = []
  if ((g.storage_used_pct ?? 0) >= 80) issues.push(`storage ${g.storage_used_pct}% full`)
  if (g.free_heap != null && g.free_heap < 40_000) issues.push('low memory')
  if (g.wifi_rssi != null && g.wifi_rssi < -80) issues.push('weak WiFi')
  return issues.length ? `Check: ${issues.join(', ')}` : 'Good'
}

const resultLabel: Record<HotspotReport['result'], string> = {
  created: 'SOS created',
  already_active: 'Already had an active SOS',
  not_registered: 'Number not registered',
  rejected: 'Rejected',
}

export function DevicesPage({ isSuperAdmin, scopeBarangayId, barangayOptions }: DevicesPageProps) {
  const [devices, setDevices] = useState<Gateway[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [pairing, setPairing] = useState(false)
  const [secret, setSecret] = useState<(GatewaySecret & { fresh: boolean }) | null>(null)

  const load = useCallback(async () => {
    try {
      setDevices(await listGateways())
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load ESP32 devices.')
    } finally {
      setLoading(false)
      setNow(Date.now())
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    void load()
  }, [load])
  useLiveSignal(['devices'], () => void load())
  // Online/Offline depends on the clock, so re-check every 30 s even when nothing changed.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  const shown = devices.filter((g) => scopeBarangayId == null || g.barangay_id === scopeBarangayId)

  async function run(g: Gateway, action: () => Promise<void>, done: string) {
    setBusyId(g.gateway_id)
    setNotice(null)
    try {
      await action()
      setNotice(done)
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'That did not work. Please try again.')
    } finally {
      setBusyId(null)
    }
  }

  function toggleActive(g: Gateway) {
    if (g.active && !window.confirm(`Disconnect ${g.name}? It keeps collecting SOS from residents, but PriorityCare stops accepting its reports until you reconnect it.`)) return
    void run(g, () => setGatewayActive(g.gateway_id, !g.active), g.active ? `${g.name} is disconnected.` : `${g.name} is connected again.`)
  }

  function command(g: Gateway, cmd: GatewayCommand) {
    void run(g, () => queueGatewayCommand(g.gateway_id, cmd),
      cmd === 'resync'
        ? `${g.name} will send its waiting reports on its next check-in (within a minute while online).`
        : `${g.name} will restart on its next check-in. Saved reports are kept.`)
  }

  function rotate(g: Gateway) {
    if (!window.confirm(`Make a new secret for ${g.name}? The old one stops working at once, so the device stays offline until the new secret is entered on its Settings page.`)) return
    setBusyId(g.gateway_id)
    setNotice(null)
    rotateGatewaySecret(g.gateway_id)
      .then((s) => { setSecret({ ...s, fresh: false }); return load() })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to make a new secret.'))
      .finally(() => setBusyId(null))
  }

  function assign(g: Gateway, value: string) {
    const id = value ? Number(value) : null
    void run(g, () => assignGatewayBarangay(g.gateway_id, id), `${g.name} now serves ${barangayOptions?.find((b) => b.barangay_id === id)?.barangay_name ?? 'no barangay'}.`)
  }

  return (
    <section className="panel">
      <div className="evac-toolbar">
        <p className="evac-sub" style={{ flex: 1, minWidth: 240 }}>
          Each ESP32 broadcasts the open WiFi "PriorityCare SOS". Residents with no load join it and send an SOS; the device keeps it until PriorityCare confirms it.
        </p>
        <button type="button" className="verify-button" onClick={() => setPairing(true)}>Connect ESP32</button>
      </div>

      {error && <p role="alert" className="dashboard-error">{error}</p>}
      {notice && <p role="status" className="panel-note">{notice}</p>}
      {loading && <p className="evac-sub">Loading devices…</p>}
      {!loading && !error && shown.length === 0 && (
        <p className="empty-documents">No ESP32 devices yet. Press Connect ESP32 to add one.</p>
      )}

      <div className="evac-grid device-grid">
        {shown.map((g) => {
          const state = deviceState(g, now)
          const busy = busyId === g.gateway_id
          const pending = g.pending_count ?? 0
          return (
            <article className="evac-card" key={g.gateway_id}>
              <div className="evac-card-head">
                <div>
                  <h3 style={{ margin: 0 }}>{g.name}</h3>
                  <p className="evac-sub">{g.gateway_id}{g.barangay_name ? ` · Barangay ${g.barangay_name}` : ' · No barangay'}</p>
                </div>
                <span className={`evac-badge ${stateClass[state]}`}>{stateLabel[state]}</span>
              </div>

              {pending > 0 && (
                <p className="dashboard-error" style={{ margin: 0 }}>
                  {pending} SOS waiting on the device{state === 'online' ? ', sending now.' : '. Staff at the hall can see them in the local console.'}
                </p>
              )}

              <dl className="device-facts" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', margin: 0, fontSize: 14 }}>
                <dt>Last communication</dt><dd style={{ margin: 0 }}>{ago(g.last_heartbeat_at, now)}</dd>
                <dt>Last sync</dt><dd style={{ margin: 0 }}>{ago(g.last_sync_at, now)}</dd>
                <dt>Internet WiFi</dt><dd style={{ margin: 0 }}>{g.wifi_ssid ? `${g.wifi_ssid}${signal(g.wifi_rssi)}` : 'Unknown'}</dd>
                <dt>IP address</dt><dd style={{ margin: 0 }}>{g.sta_ip || 'Unknown'}</dd>
                <dt>Waiting to send</dt><dd style={{ margin: 0 }}>{g.pending_count ?? 'Unknown'}</dd>
                <dt>Phones on SOS WiFi</dt><dd style={{ margin: 0 }}>{g.clients_connected ?? 'Unknown'}</dd>
                <dt>Reports received</dt><dd style={{ margin: 0 }}>{g.reports_total}</dd>
                <dt>Health</dt><dd style={{ margin: 0 }}>{g.last_heartbeat_at ? health(g) : 'Unknown'}</dd>
                <dt>Running for</dt><dd style={{ margin: 0 }}>{uptime(g.uptime_s)}{g.firmware_version ? ` · firmware ${g.firmware_version}` : ''}</dd>
              </dl>
              {g.open_commands > 0 && <p className="evac-sub">{g.open_commands} request(s) waiting for the device to check in.</p>}

              {isSuperAdmin && barangayOptions && (
                <label className="evac-sub">
                  Serves{' '}
                  <select value={g.barangay_id ?? ''} disabled={busy} onChange={(e) => assign(g, e.target.value)}>
                    <option value="">No barangay</option>
                    {barangayOptions.map((b) => <option key={b.barangay_id} value={b.barangay_id}>{b.barangay_name}</option>)}
                  </select>
                </label>
              )}

              <div className="evac-actions">
                <button type="button" className="secondary-button" disabled={busy || !g.active} onClick={() => command(g, 'resync')}>Send waiting reports</button>
                <button type="button" className="secondary-button" disabled={busy || !g.active} onClick={() => command(g, 'reboot')}>Restart</button>
                <button type="button" className="secondary-button" disabled={busy} onClick={() => toggleActive(g)}>{g.active ? 'Disconnect' : 'Reconnect'}</button>
                <button type="button" className="secondary-button" disabled={busy} onClick={() => rotate(g)}>New secret</button>
                {g.sta_ip && (
                  <a className="secondary-button" href={`http://${g.sta_ip}/staff`} target="_blank" rel="noreferrer"
                     title="Works only on the same WiFi as the device">
                    Open local console
                  </a>
                )}
              </div>
              {g.sta_ip && <p className="evac-sub">The local console opens only when this computer is on {g.wifi_ssid ?? 'the same WiFi as the device'}.</p>}

              <DeviceReports gatewayId={g.gateway_id} total={g.reports_total} />
            </article>
          )
        })}
      </div>

      {pairing && (
        <PairDialog
          isSuperAdmin={isSuperAdmin}
          scopeBarangayId={scopeBarangayId}
          barangayOptions={barangayOptions}
          onClose={() => setPairing(false)}
          onPaired={(s) => { setPairing(false); setSecret({ ...s, fresh: true }); void load() }}
        />
      )}
      {secret && <SecretDialog secret={secret} onClose={() => setSecret(null)} />}
    </section>
  )
}

function DeviceReports({ gatewayId, total }: { gatewayId: string; total: number }) {
  const [reports, setReports] = useState<HotspotReport[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  function open(e: SyntheticEvent<HTMLDetailsElement>) {
    if (!e.currentTarget.open || reports) return
    listHotspotReports(gatewayId)
      .then(setReports)
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load reports.'))
  }

  return (
    <details className="evac-people" onToggle={open}>
      <summary>Reports from this device ({total})</summary>
      {error && <p role="alert" className="dashboard-error">{error}</p>}
      {!reports && !error && <p className="evac-sub">Loading…</p>}
      {reports && reports.length === 0 && <p className="evac-sub">No reports yet.</p>}
      {reports && reports.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead><tr><th>Received</th><th>Number</th><th>Type</th><th>Result</th></tr></thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.report_id}>
                  <td>{new Date(r.device_received_at ?? r.phone_time ?? r.synced_at).toLocaleString()}</td>
                  <td>{r.contact_no}</td>
                  <td>{r.alert_type}{r.note ? `: ${r.note}` : ''}</td>
                  <td>{resultLabel[r.result]}{r.reason ? ` (${r.reason})` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  )
}

function PairDialog({ isSuperAdmin, scopeBarangayId, barangayOptions, onClose, onPaired }: {
  isSuperAdmin: boolean
  scopeBarangayId: number | null
  barangayOptions?: { barangay_id: number; barangay_name: string }[]
  onClose: () => void
  onPaired: (s: GatewaySecret) => void
}) {
  const [name, setName] = useState('')
  const [barangay, setBarangay] = useState(scopeBarangayId != null ? String(scopeBarangayId) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const barangayId = isSuperAdmin ? (barangay ? Number(barangay) : null) : scopeBarangayId
    if (barangayId == null) { setError('Choose the barangay this device serves.'); return }
    setSaving(true)
    setError(null)
    try {
      onPaired(await pairGateway(name.trim(), barangayId))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to connect this device.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="pair-title">
      <section className="edit-modal">
        <div className="request-modal-header">
          <div><h3 id="pair-title">Connect ESP32</h3><p>Registers a new SOS hotspot and gives it a secret.</p></div>
          <button type="button" className="modal-close-button" aria-label="Close" disabled={saving} onClick={onClose}>×</button>
        </div>
        {error && <p role="alert" className="dashboard-error">{error}</p>}
        <form onSubmit={submit}>
          <fieldset disabled={saving} className="resident-edit-fields">
            <div className="edit-form-grid">
              <label><span>Where it is installed</span><input required maxLength={80} placeholder="e.g. Barangay Hall" value={name} onChange={(e) => setName(e.target.value)} /></label>
              {isSuperAdmin && barangayOptions && (
                <label><span>Barangay it serves</span>
                  <select required value={barangay} onChange={(e) => setBarangay(e.target.value)}>
                    <option value="">Choose a barangay</option>
                    {barangayOptions.map((b) => <option key={b.barangay_id} value={b.barangay_id}>{b.barangay_name}</option>)}
                  </select>
                </label>
              )}
            </div>
          </fieldset>
          <div className="request-modal-actions">
            <button type="button" className="secondary-button" disabled={saving} onClick={onClose}>Cancel</button>
            <button type="submit" className="verify-button large" disabled={saving}>{saving ? 'Connecting…' : 'Connect'}</button>
          </div>
        </form>
      </section>
    </div>
  )
}

function SecretDialog({ secret, onClose }: { secret: GatewaySecret & { fresh: boolean }; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    void navigator.clipboard?.writeText(secret.secret).then(() => setCopied(true))
  }
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="secret-title">
      <section className="edit-modal">
        <div className="request-modal-header">
          <div><h3 id="secret-title">{secret.fresh ? 'ESP32 connected' : 'New secret made'}</h3><p>This secret is shown only once. Enter it on the device now.</p></div>
          <button type="button" className="modal-close-button" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 12px' }}>
          <dt>Device ID</dt><dd style={{ margin: 0 }}><strong style={{ fontFamily: 'monospace', fontSize: 18 }}>{secret.gateway_id}</strong></dd>
          <dt>Device secret</dt><dd style={{ margin: 0 }}><strong style={{ fontFamily: 'monospace', fontSize: 18, wordBreak: 'break-all' }}>{secret.secret}</strong></dd>
        </dl>
        <ol>
          <li>Join the WiFi "PriorityCare SOS" (or the hall WiFi, if the device is already on it).</li>
          <li>Open http://192.168.4.1/staff and log in with the staff PIN.</li>
          <li>Open Settings, enter this Device ID and secret, and save.</li>
        </ol>
        <p className="evac-sub">The card shows Online within a minute once the device reaches PriorityCare.</p>
        <div className="request-modal-actions">
          <button type="button" className="secondary-button" onClick={copy}>{copied ? 'Copied' : 'Copy secret'}</button>
          <button type="button" className="verify-button large" onClick={onClose}>Done</button>
        </div>
      </section>
    </div>
  )
}
