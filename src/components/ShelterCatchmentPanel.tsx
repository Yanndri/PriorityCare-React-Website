import { useEffect, useState } from 'react'
import { getShelterAssignments, setSitioShelters } from '../api/shelterPlanApi'
import { shelterLoad, sitioPopulation, validatePlan } from '../utils/shelterCatchments'
import type { PlanSitio, ShelterPlanData } from '../utils/shelterCatchments'
import './ShelterCatchmentPanel.css'

type Draft = { primary: string; alternates: string[]; note: string }

const LOAD_LABEL = { ok: 'Within capacity', near: 'Near capacity', over: 'Over capacity', unknown: 'Capacity not set', unused: 'Not a primary shelter' }

function toDraft(s: PlanSitio): Draft {
  const alts = s.alternate_center_ids.map(String)
  return { primary: s.primary_center_id === null ? '' : String(s.primary_center_id), alternates: [...alts, '', '', ''].slice(0, 3), note: s.note }
}

export function ShelterCatchmentPanel() {
  const [data, setData] = useState<ShelterPlanData | null>(null)
  const [drafts, setDrafts] = useState<Record<number, Draft>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  function apply(d: ShelterPlanData) {
    setData(d)
    setDrafts(Object.fromEntries(d.sitios.map(s => [s.sitio_id, toDraft(s)])))
  }
  async function load() {
    setLoading(true); setError('')
    try { apply(await getShelterAssignments()) }
    catch (e) { setData(null); setError(e instanceof Error ? e.message : 'Unable to load shelter assignments.') }
    finally { setLoading(false) }
  }
  useEffect(() => {
    let cancelled = false
    getShelterAssignments().then(d => { if (!cancelled) apply(d) })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Unable to load shelter assignments.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const centerName = (id: number) => data?.centers.find(c => c.center_id === id)?.center_name ?? `Center ${id}`
  const edit = (sitioId: number, patch: Partial<Draft>) => setDrafts(d => ({ ...d, [sitioId]: { ...d[sitioId], ...patch } }))

  async function save(s: PlanSitio) {
    if (!data) return
    const d = drafts[s.sitio_id]
    const primary = d.primary ? Number(d.primary) : null
    const alternates = d.alternates.filter(Boolean).map(Number)
    const problem = validatePlan(primary, alternates, data.centers, d.note)
    setError(''); setNotice('')
    if (problem) { setError(`${s.sitio_name}: ${problem}`); return }
    setSaving(s.sitio_id)
    try {
      await setSitioShelters(s.sitio_id, primary, alternates, d.note)
      setNotice(primary === null ? `${s.sitio_name}: assignment cleared.` : `${s.sitio_name} now evacuates to ${centerName(primary)}.`)
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed.') }
    finally { setSaving(null) }
  }

  const dirty = (s: PlanSitio) => JSON.stringify(drafts[s.sitio_id]) !== JSON.stringify(toDraft(s))
  const activeCenters = (data?.centers ?? []).filter(c => c.status !== 'closed')

  return <section className="panel catchment-panel">
    <div className="section-header"><div><span className="panel-kicker">CATCHMENT PLAN</span><h3>Sitio → Designated Shelters</h3></div>
      <button type="button" className="secondary-button" disabled={loading || saving !== null} onClick={() => void load()}>Refresh</button></div>
    <p className="catchment-muted">Assign each sitio a primary evacuation shelter and up to 3 alternates (used when the primary is full or unreachable). The Geo Map draws these links. Population = registered residents + listed dependents.</p>
    {loading && <p role="status">Loading assignments…</p>}
    {error && <p role="alert" className="dashboard-error">{error}</p>}
    {notice && <p role="status" className="catchment-notice">{notice}</p>}
    {data && <>
      <div className="catchment-table-wrap"><table className="catchment-table">
        <thead><tr><th>Sitio</th><th>Population</th><th>Primary shelter</th><th>Alternates (in order)</th><th>Note</th><th /></tr></thead>
        <tbody>{data.sitios.map(s => {
          const d = drafts[s.sitio_id]
          if (!d) return null
          const locked = !s.editable || saving !== null
          return <tr key={s.sitio_id}>
            <td><strong>{s.sitio_name}</strong>{s.updated_at && <div className="catchment-muted"><small>Updated {new Date(s.updated_at).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila' })}{s.updated_by_name ? ` by ${s.updated_by_name}` : ''}</small></div>}
              {!s.editable && <div className="catchment-muted"><small>View only (other sitio)</small></div>}</td>
            <td>{sitioPopulation(s)}<div className="catchment-muted"><small>{s.residents} residents · {s.dependents} dependents</small></div></td>
            <td><select aria-label={`${s.sitio_name} primary shelter`} disabled={locked} value={d.primary} onChange={e => edit(s.sitio_id, { primary: e.target.value })}>
              <option value="">Not assigned</option>
              {data.centers.map(c => <option key={c.center_id} value={c.center_id} disabled={c.status === 'closed'}>{c.center_name}{c.status === 'closed' ? ' (closed)' : ''}</option>)}
            </select></td>
            <td className="catchment-alts">{d.alternates.map((a, i) => <select key={i} aria-label={`${s.sitio_name} alternate ${i + 1}`} disabled={locked || !d.primary} value={a}
              onChange={e => edit(s.sitio_id, { alternates: d.alternates.map((x, j) => j === i ? e.target.value : x) })}>
              <option value="">{i + 1}. —</option>
              {data.centers.map(c => <option key={c.center_id} value={c.center_id}>{i + 1}. {c.center_name}{c.status === 'closed' ? ' (closed)' : ''}</option>)}
            </select>)}</td>
            <td><input aria-label={`${s.sitio_name} note`} disabled={locked} maxLength={500} value={d.note} placeholder="e.g. Purok 1–3 via bridge road"
              onChange={e => edit(s.sitio_id, { note: e.target.value })} /></td>
            <td>{s.editable && <button type="button" className="verify-button" disabled={saving !== null || !dirty(s)} onClick={() => void save(s)}>
              {saving === s.sitio_id ? 'Saving…' : 'Save'}</button>}</td>
          </tr>
        })}</tbody>
      </table></div>

      <h4 className="catchment-subhead">Shelter load from primary assignments</h4>
      <div className="catchment-table-wrap"><table className="catchment-table">
        <thead><tr><th>Shelter</th><th>Primary for</th><th>Planned population</th><th>Max safe capacity</th><th>Status</th></tr></thead>
        <tbody>{data.centers.map(c => {
          const load = shelterLoad(c)
          return <tr key={c.center_id}>
            <td><strong>{c.center_name}</strong>{c.status === 'closed' && <div className="catchment-muted"><small>Closed</small></div>}</td>
            <td>{c.primary_for.length ? c.primary_for.map(id => data.sitios.find(s => s.sitio_id === id)?.sitio_name ?? `Sitio ${id}`).join(', ') : '—'}</td>
            <td>{load.planned}</td>
            <td>{load.capacity ?? '—'}</td>
            <td><span className={`catchment-load load-${load.status}`}>{LOAD_LABEL[load.status]}{load.ratio !== null ? ` · ${Math.round(load.ratio * 100)}%` : ''}</span></td>
          </tr>
        })}</tbody>
      </table></div>
      {activeCenters.length === 0 && <p className="catchment-muted">No active evacuation centers. Register one above first.</p>}
      <p className="catchment-muted">Planned population assumes everyone in the sitio goes to its primary shelter. It is a planning estimate, not current occupancy.</p>
    </>}
  </section>
}
