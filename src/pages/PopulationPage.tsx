import { useMemo, useState, type FormEvent } from 'react'
import type { ConstraintStat, Resident } from '../types/dashboard'
import { scoreHouseholds } from '../utils/householdVpi'
import { ConstraintChart } from '../components/ConstraintChart'
import { addSitio, removeSitio, renameSitio, useSitios } from '../api/sitiosApi'

// Sitios & Population: the barangay's official sitio list (residents pick from it
// when they register in the app) and how many people live in each sitio.
// People are counted from registered households: account holders plus the
// family members they listed.

const NO_SITIO = '(No sitio given)'

type Totals = { households: number; people: number; children: number; seniors: number; pregnant: number; cannotWalk: number; critical: number }
const empty = (): Totals => ({ households: 0, people: 0, children: 0, seniors: 0, pregnant: 0, cannotWalk: 0, critical: 0 })
type Row = { name: string; totals: Totals; sitioId?: number }

type Props = {
  residents: Resident[]
  constraintStats?: ConstraintStat[] // no longer used: the mobility chart is worked out here
  barangayId: number | null // the barangay in scope; null = super admin viewing all barangays
  barangayName: string
  // Super admin viewing all barangays: pick one here to see and manage its sitios.
  barangayOptions?: { barangay_id: number; barangay_name: string }[]
}

export function PopulationPage({ residents: allResidents, barangayId: scopeBarangayId, barangayName: scopeBarangayName, barangayOptions = [] }: Props) {
  const [filter, setFilter] = useState('all')
  // Barangay picked on this page when the header is on "All barangays".
  const [picked, setPicked] = useState<number | null>(null)
  const barangayId = scopeBarangayId ?? picked
  const barangayName = scopeBarangayId !== null
    ? scopeBarangayName
    : barangayOptions.find((b) => b.barangay_id === picked)?.barangay_name ?? ''
  const residents = useMemo(
    () => (scopeBarangayId === null && picked !== null ? allResidents.filter((r) => r.barangay === barangayName) : allResidents),
    [allResidents, scopeBarangayId, picked, barangayName],
  )
  function pickBarangay(id: number | null) {
    setPicked(id); setFilter('all'); setEditing(null); setError('')
  }
  const { sitios, error: loadError, reload } = useSitios(barangayId)
  const [newName, setNewName] = useState('')
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const households = useMemo(() => scoreHouseholds(residents), [residents])

  // One row per sitio. With one barangay in scope, every official sitio has a row
  // (even with nobody in it yet). With all barangays, the barangay is added to the
  // name, because two barangays can have a sitio with the same name.
  const rows = useMemo(() => {
    // All barangays: one row per barangay (sitios only make sense inside one barangay).
    const byBarangay = barangayId === null
    const byKey = new Map<string, Row>()
    if (!byBarangay) for (const s of sitios) byKey.set(s.sitio_name.trim().toLowerCase(), { name: s.sitio_name, totals: empty(), sitioId: s.sitio_id })
    for (const h of households) {
      const name = byBarangay ? (h.barangay || 'Unknown barangay') : (h.sitio || NO_SITIO)
      const key = name.trim().toLowerCase()
      const row = byKey.get(key) ?? { name, totals: empty() }
      const t = row.totals
      t.households++
      t.people += h.size
      t.children += h.counts.childrenCount
      t.seniors += h.counts.seniorsCount
      t.pregnant += h.counts.pregnantCount
      t.cannotWalk += h.counts.nonAmbulatoryCount + h.counts.semiCount
      if (h.priority === 'CRITICAL') t.critical++
      byKey.set(key, row)
    }
    return [...byKey.values()].sort((a, b) => b.totals.people - a.totals.people || a.name.localeCompare(b.name))
  }, [households, sitios, barangayId])

  const shown = filter === 'all' ? rows : rows.filter(r => r.name === filter)
  const total = shown.reduce((sum, r) => {
    for (const k of Object.keys(sum) as (keyof Totals)[]) sum[k] += r.totals[k]
    return sum
  }, empty())
  const cards: [string, number][] = [
    ['Households', total.households], ['People', total.people], ['Children (under 12)', total.children],
    ['Seniors (60+)', total.seniors], ['Pregnant', total.pregnant], ['Cannot walk alone', total.cannotWalk],
    ['Critical households', total.critical],
  ]

  async function run(action: () => Promise<void>) {
    setBusy(true); setError('')
    try { await action(); await reload() }
    catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.') }
    finally { setBusy(false) }
  }
  function add(event: FormEvent) {
    event.preventDefault()
    if (barangayId === null || !newName.trim()) return
    void run(async () => { await addSitio(barangayId, newName); setNewName('') })
  }
  function saveRename(event: FormEvent) {
    event.preventDefault()
    if (!editing || !editing.name.trim()) return
    void run(async () => { await renameSitio(editing.id, editing.name); setEditing(null) })
  }
  function remove(id: number, name: string) {
    if (!window.confirm(`Remove ${name} from the list? Residents already registered there keep it on their record.`)) return
    void run(() => removeSitio(id))
  }

  const canManage = barangayId !== null

  // Everyone in the households shown (account holders and their family members), by mobility.
  const shownHouseholds = filter === 'all' ? households
    : households.filter(h => (canManage ? (h.sitio || NO_SITIO) : (h.barangay || 'Unknown barangay')) === filter)
  const mobilityStats: ConstraintStat[] = (() => {
    const cannot = shownHouseholds.reduce((n, h) => n + h.counts.nonAmbulatoryCount, 0)
    const help = shownHouseholds.reduce((n, h) => n + h.counts.semiCount, 0)
    const all = shownHouseholds.reduce((n, h) => n + h.size, 0)
    const can = Math.max(0, all - cannot - help)
    const pct = (v: number) => (all ? Math.round((v / all) * 100) : 0)
    return [
      { label: 'Can walk', value: can, percent: pct(can) },
      { label: 'Needs help walking', value: help, percent: pct(help) },
      { label: 'Cannot walk', value: cannot, percent: pct(cannot) },
    ] as ConstraintStat[]
  })()

  return (
    <section className="population-page">
      <div className="population-filter">
        {scopeBarangayId === null && (
          <label>Barangay
            <select value={picked ?? ''} onChange={e => pickBarangay(e.target.value === '' ? null : Number(e.target.value))}>
              <option value="">All barangays</option>
              {barangayOptions.map(b => <option key={b.barangay_id} value={b.barangay_id}>{b.barangay_name}</option>)}
            </select>
          </label>
        )}
        <label>Show
          <select value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="all">{canManage ? 'All sitios' : 'All barangays'}</option>
            {rows.map(r => <option key={r.name} value={r.name}>{r.name}</option>)}
          </select>
        </label>
      </div>

      <div className="population-cards">
        {cards.map(([label, value]) => (
          <article key={label} className="population-card"><strong>{value}</strong><span>{label}</span></article>
        ))}
      </div>

      <ConstraintChart title="People by mobility" stats={mobilityStats} />

      <section className="panel">
        <h3>{canManage ? `Sitios in ${barangayName}` : 'Barangays'}</h3>
        <p className="population-note">
          {canManage
            ? 'Residents pick their sitio from this list when they register in the app. Click a row to see only its numbers.'
            : 'Pick a barangay in the Barangay box above, or click its row, to see its sitios and add, rename or remove them.'}
        </p>

        {canManage && (
          <form className="sitios-add" onSubmit={add}>
            <input value={newName} maxLength={80} placeholder="New sitio name, e.g. Sitio Mahayahay" aria-label="New sitio name" onChange={e => setNewName(e.target.value)} />
            <button type="submit" className="verify-button" disabled={busy || !newName.trim()}>Add sitio</button>
          </form>
        )}
        {(error || (canManage && loadError)) && <p role="alert" className="dashboard-error">{error || loadError}</p>}

        <div className="relief-table-wrap">
          <table className="relief-table">
            <thead>
              <tr><th>{canManage ? 'Sitio' : 'Barangay'}</th><th>Households</th><th>People</th><th>Children</th><th>Seniors</th><th>Pregnant</th><th>Cannot walk alone</th><th>Critical households</th>{canManage && <th />}</tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={canManage ? 9 : 8}>No sitios or registered households yet.</td></tr>}
              {rows.map(r => {
                const t = r.totals
                if (editing && editing.id === r.sitioId) {
                  return (
                    <tr key={r.name}>
                      <td colSpan={9}>
                        <form className="sitios-rename" onSubmit={saveRename}>
                          <input autoFocus value={editing.name} maxLength={80} aria-label="Sitio name" onChange={e => setEditing({ id: editing.id, name: e.target.value })} />
                          <button type="submit" className="verify-button" disabled={busy || !editing.name.trim()}>Save</button>
                          <button type="button" className="secondary-button" onClick={() => setEditing(null)}>Cancel</button>
                        </form>
                      </td>
                    </tr>
                  )
                }
                return (
                  <tr key={r.name} className={`population-row ${filter === r.name ? 'selected' : ''}`} onClick={() => {
                    if (!canManage) {
                      const b = barangayOptions.find((o) => o.barangay_name === r.name)
                      if (b) { pickBarangay(b.barangay_id); return }
                    }
                    setFilter(filter === r.name ? 'all' : r.name)
                  }}>
                    <td>{r.name}{canManage && r.sitioId === undefined && r.name !== NO_SITIO && <small className="sitio-unlisted"> not on the list</small>}</td>
                    <td>{t.households}</td><td>{t.people}</td><td>{t.children}</td><td>{t.seniors}</td>
                    <td>{t.pregnant}</td><td>{t.cannotWalk}</td><td>{t.critical}</td>
                    {canManage && (
                      <td onClick={e => e.stopPropagation()}>
                        {r.sitioId !== undefined && (
                          <span className="sitios-buttons">
                            <button type="button" className="secondary-button" disabled={busy} onClick={() => setEditing({ id: r.sitioId!, name: r.name })}>Rename</button>
                            <button type="button" className="secondary-button" disabled={busy} onClick={() => remove(r.sitioId!, r.name)}>Remove</button>
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {canManage && <p className="sitios-hint">Renaming a sitio also updates the residents who chose it.</p>}
      </section>

    </section>
  )
}
