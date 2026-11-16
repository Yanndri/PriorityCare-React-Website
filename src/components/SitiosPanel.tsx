import { useState, type FormEvent } from 'react'
import { addSitio, removeSitio, useSitios } from '../api/sitiosApi'

// Staff keep their barangay's official sitio list. Residents choose from it when they
// register in the app, so names are spelled the same way everywhere.
type Props = {
  barangays: { barangay_id: number; barangay_name: string }[]
  defaultBarangayId: number | null
}

export function SitiosPanel({ barangays, defaultBarangayId }: Props) {
  const [picked, setPicked] = useState<number | null>(defaultBarangayId ?? (barangays.length === 1 ? barangays[0].barangay_id : null))
  const barangayId = defaultBarangayId ?? picked
  const { sitios, error: loadError, reload } = useSitios(barangayId)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function add(event: FormEvent) {
    event.preventDefault()
    if (barangayId === null || !name.trim()) return
    setBusy(true); setError('')
    try { await addSitio(barangayId, name); setName(''); await reload() }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to add the sitio.') }
    finally { setBusy(false) }
  }

  async function remove(id: number, label: string) {
    if (!window.confirm(`Remove ${label} from the list? Residents already registered there keep it on their record.`)) return
    setBusy(true); setError('')
    try { await removeSitio(id); await reload() }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to remove the sitio.') }
    finally { setBusy(false) }
  }

  return <section className="panel sitios-panel">
    <div className="section-header"><div><h3>Sitios</h3><span>{barangayId === null ? 'Choose a barangay' : `${sitios.length} on the list`}</span></div></div>
    <p>Residents pick their sitio from this list when they register in the app. Use the official names.</p>
    {defaultBarangayId === null && barangays.length > 1 && (
      <label className="sitios-barangay"><span>Barangay</span>
        <select value={picked ?? ''} onChange={(e) => setPicked(e.target.value ? Number(e.target.value) : null)}>
          <option value="">Select barangay…</option>
          {barangays.map((b) => <option key={b.barangay_id} value={b.barangay_id}>{b.barangay_name}</option>)}
        </select></label>
    )}
    {(error || loadError) && <p role="alert" className="dashboard-error">{error || loadError}</p>}
    {barangayId !== null && <>
      {sitios.length === 0 && !loadError && <p className="empty-state">No sitios yet. Add the first one below.</p>}
      <ul className="sitios-list">
        {sitios.map((s) => <li key={s.sitio_id}>
          <span>{s.sitio_name}</span>
          <button type="button" className="secondary-button" disabled={busy} aria-label={`Remove ${s.sitio_name}`}
            onClick={() => void remove(s.sitio_id, s.sitio_name)}>Remove</button>
        </li>)}
      </ul>
      <form className="sitios-add" onSubmit={(e) => void add(e)}>
        <input value={name} maxLength={80} placeholder="e.g. Sitio Mahayahay" aria-label="New sitio name" onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="verify-button" disabled={busy || !name.trim()}>Add sitio</button>
      </form>
    </>}
  </section>
}
