import { useState, type FormEvent } from 'react'
import type { Resident } from '../types/dashboard'
import { addSitio, removeSitio, renameSitio, useSitios } from '../api/sitiosApi'

// The barangay's official sitio list. Residents pick their sitio from it when they
// register in the app, so every name is spelled the same way.
type Props = {
  barangays: { barangay_id: number; barangay_name: string }[]
  residents: Resident[]
  defaultBarangayId: number | null // the barangay in scope; null = super admin viewing all
}

export function SitiosPage({ barangays, residents, defaultBarangayId }: Props) {
  const [picked, setPicked] = useState<number | null>(defaultBarangayId ?? (barangays.length === 1 ? barangays[0].barangay_id : null))
  const barangayId = defaultBarangayId ?? picked
  const barangayName = barangays.find(b => b.barangay_id === barangayId)?.barangay_name
  const { sitios, error: loadError, reload } = useSitios(barangayId)
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // How many registered residents in this barangay use each sitio name.
  const usedBy = (sitio: string) => residents.filter(r =>
    r.barangay === barangayName && (r.sitio ?? '').trim().toLowerCase() === sitio.trim().toLowerCase()).length

  async function run(action: () => Promise<void>) {
    setBusy(true); setError('')
    try { await action(); await reload() }
    catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.') }
    finally { setBusy(false) }
  }

  function add(event: FormEvent) {
    event.preventDefault()
    if (barangayId === null || !name.trim()) return
    void run(async () => { await addSitio(barangayId, name); setName('') })
  }

  function saveRename(event: FormEvent) {
    event.preventDefault()
    if (!editing || !editing.name.trim()) return
    void run(async () => { await renameSitio(editing.id, editing.name); setEditing(null) })
  }

  function remove(id: number, label: string) {
    if (!window.confirm(`Remove ${label} from the list? Residents already registered there keep it on their record.`)) return
    void run(() => removeSitio(id))
  }

  return (
    <section className="panel sitios-page">
      {defaultBarangayId === null && barangays.length > 1 && (
        <label className="sitios-barangay"><span>Barangay</span>
          <select value={picked ?? ''} onChange={e => { setPicked(e.target.value ? Number(e.target.value) : null); setEditing(null) }}>
            <option value="">Choose a barangay…</option>
            {barangays.map(b => <option key={b.barangay_id} value={b.barangay_id}>{b.barangay_name}</option>)}
          </select>
        </label>
      )}

      {(error || loadError) && <p role="alert" className="dashboard-error">{error || loadError}</p>}

      {barangayId === null ? <p>Choose a barangay to see its sitios.</p> : <>
        <form className="sitios-add" onSubmit={add}>
          <input value={name} maxLength={80} placeholder="New sitio name, e.g. Sitio Mahayahay" aria-label="New sitio name" onChange={e => setName(e.target.value)} />
          <button type="submit" className="verify-button" disabled={busy || !name.trim()}>Add sitio</button>
        </form>

        <h3 className="sitios-count">{sitios.length} {sitios.length === 1 ? 'sitio' : 'sitios'}{barangayName ? ` in ${barangayName}` : ''}</h3>
        {sitios.length === 0 && !loadError && <p className="empty-state">No sitios yet. Add the first one above.</p>}

        <ul className="sitios-list">
          {sitios.map(s => (
            <li key={s.sitio_id}>
              {editing?.id === s.sitio_id ? (
                <form className="sitios-rename" onSubmit={saveRename}>
                  <input autoFocus value={editing.name} maxLength={80} aria-label="Sitio name" onChange={e => setEditing({ id: s.sitio_id, name: e.target.value })} />
                  <button type="submit" className="verify-button" disabled={busy || !editing.name.trim()}>Save</button>
                  <button type="button" className="secondary-button" onClick={() => setEditing(null)}>Cancel</button>
                </form>
              ) : <>
                <span><strong>{s.sitio_name}</strong> <small>{usedBy(s.sitio_name)} resident(s)</small></span>
                <span className="sitios-buttons">
                  <button type="button" className="secondary-button" disabled={busy} onClick={() => setEditing({ id: s.sitio_id, name: s.sitio_name })}>Rename</button>
                  <button type="button" className="secondary-button" disabled={busy} onClick={() => remove(s.sitio_id, s.sitio_name)}>Remove</button>
                </span>
              </>}
            </li>
          ))}
        </ul>
        <p className="sitios-hint">Renaming a sitio also updates the residents who chose it.</p>
      </>}
    </section>
  )
}
