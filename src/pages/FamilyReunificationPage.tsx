import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { getEvacueeHousehold, searchEvacuees } from '../api/reunificationApi'
import type { EvacStatus, EvacueeHousehold, EvacueePerson, EvacueeSearchResult } from '../api/reunificationApi'
import './FamilyReunificationPage.css'

const STATUS: Record<EvacStatus, { label: string; tone: string }> = {
  safely_evacuated: { label: 'Sheltered', tone: 'good' },
  in_transit: { label: 'In transit', tone: 'warn' },
  pending: { label: 'Rescue pending', tone: 'warn' },
  failed: { label: 'Not reached', tone: 'bad' },
}

const formatTime = (iso: string | null) => iso
  ? new Date(iso).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })
  : ''

function StatusBadge({ status }: { status: EvacStatus | null }) {
  const s = status ? STATUS[status] : { label: 'No evacuation record', tone: 'none' }
  return <span className={`reunite-badge ${s.tone}`}>{s.label}</span>
}

function Location({ p }: { p: { latest_status: EvacStatus | null; center_name: string | null; latest_logged_at: string | null } }) {
  if (p.latest_status === 'safely_evacuated' && p.center_name) {
    return <><strong>{p.center_name}</strong><br /><small>since {formatTime(p.latest_logged_at)}</small></>
  }
  return <span className="reunite-muted">{p.latest_status ? `Not in a shelter · ${formatTime(p.latest_logged_at)}` : 'Not in a shelter'}</span>
}

type CenterOption = { center_id: number; center_name: string; status: string | null }

export function FamilyReunificationPage() {
  const [query, setQuery] = useState('')
  const [centerId, setCenterId] = useState('')
  const [centers, setCenters] = useState<CenterOption[]>([])
  const [result, setResult] = useState<EvacueeSearchResult | null>(null)
  const [selected, setSelected] = useState<EvacueePerson | null>(null)
  const [household, setHousehold] = useState<EvacueeHousehold | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    supabase.from('evacuation_centers').select('center_id,center_name,status').order('center_name')
      .then(({ data }) => { if (!cancelled && data) setCenters(data as CenterOption[]) })
    return () => { cancelled = true }
  }, [])

  async function runSearch(event?: FormEvent) {
    event?.preventDefault()
    if (busy) return
    setError(''); setSelected(null); setHousehold(null)
    if (!centerId && query.replace(/\s/g, '').length < 2) {
      setError('Type at least 2 letters of a name, or choose an evacuation center.'); return
    }
    setBusy('Searching all evacuation centers…')
    try { setResult(await searchEvacuees(query, centerId ? Number(centerId) : null)) }
    catch (e) { setResult(null); setError(e instanceof Error ? e.message : 'Search failed.') }
    finally { setBusy('') }
  }

  async function openPerson(p: EvacueePerson) {
    setSelected(p); setHousehold(null); setError('')
    if (!p.household_id) return
    setBusy('Loading household…')
    try { setHousehold(await getEvacueeHousehold(p.uid)) }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to load the household.') }
    finally { setBusy('') }
  }

  const sheltered = (id: number) => result?.centers.find(c => c.center_id === id)?.sheltered
  const members = household?.members ?? []
  const separated = new Set(members.filter(m => m.latest_status === 'safely_evacuated').map(m => m.center_id)).size > 1
  const unaccounted = members.filter(m => m.latest_status !== 'safely_evacuated')

  return <div className="reunite-page">
    <section className="panel">
      <h3>Find a family member</h3>
      <p className="reunite-muted">Searches every evacuation center and the resident registry across all barangays. Results show only what is needed to reunite people — no contact numbers, addresses or medical details. Every lookup is logged.</p>
      <form className="reunite-search" onSubmit={e => void runSearch(e)}>
        <label className="reunite-grow"><span>Name</span>
          <input type="search" value={query} maxLength={100} onChange={e => setQuery(e.target.value)} placeholder="e.g. Mercado, or Lorna Mercado" autoFocus /></label>
        <label><span>Evacuation center</span>
          <select value={centerId} onChange={e => setCenterId(e.target.value)}>
            <option value="">All centers + not yet sheltered</option>
            {centers.map(c => <option key={c.center_id} value={c.center_id}>{c.center_name}{c.status === 'closed' ? ' (closed)' : ''}</option>)}
          </select></label>
        <button type="submit" className="primary-button" disabled={Boolean(busy)}>Search</button>
      </form>
      {busy && <p role="status" className="reunite-muted">{busy}</p>}
      {error && <p role="alert" className="reunite-error">{error}</p>}
    </section>

    {result && <section className="panel">
      <div className="reunite-head"><h3>{result.people.length} {result.people.length === 1 ? 'person' : 'people'} found</h3>
        {result.has_more && <span className="reunite-muted">Showing the first 100 — refine the name to narrow results.</span>}</div>
      {!result.people.length && <p>No one matches. Check spelling, try only the surname, or file a report on the Missing Persons page.</p>}
      {result.people.length > 0 && <div className="reunite-table-wrap"><table className="reunite-table">
        <thead><tr><th>Name</th><th>Sex / age</th><th>Home barangay</th><th>Status</th><th>Current location</th><th>Household</th><th /></tr></thead>
        <tbody>{result.people.map(p => <tr key={p.uid} className={selected?.uid === p.uid ? 'selected' : ''}>
          <td><strong>{p.full_name}</strong>{p.open_missing_report && <div><span className="reunite-badge bad">Reported missing</span></div>}</td>
          <td>{[p.sex, p.age !== null ? `${p.age} yrs` : null].filter(Boolean).join(' · ') || '—'}</td>
          <td>{p.home_barangay ?? '—'}</td>
          <td><StatusBadge status={p.latest_status} /></td>
          <td><Location p={p} />{p.center_id !== null && p.latest_status === 'safely_evacuated' && sheltered(p.center_id) !== undefined &&
            <div className="reunite-muted"><small>{sheltered(p.center_id)} sheltered there</small></div>}</td>
          <td>{p.household_name ?? <span className="reunite-muted">Not linked</span>}</td>
          <td><button type="button" className="secondary-button" onClick={() => void openPerson(p)}>{p.household_id ? 'View family' : 'Details'}</button></td>
        </tr>)}</tbody>
      </table></div>}
    </section>}

    {selected && <section className="panel reunite-family">
      <div className="reunite-head"><h3>{household?.household_name ?? selected.full_name}</h3>
        <button type="button" className="secondary-button" onClick={() => { setSelected(null); setHousehold(null) }}>Close</button></div>
      {!selected.household_id && <p>{selected.full_name} is not linked to a household, so other family members can't be listed automatically. Search their names individually.</p>}
      {household && <>
        {separated && <p className="reunite-alert">This family is split across different evacuation centers.</p>}
        {unaccounted.length > 0 && <p className="reunite-alert bad">{unaccounted.length} registered member{unaccounted.length === 1 ? ' is' : 's are'} not confirmed in a shelter: {unaccounted.map(m => m.full_name).join(', ')}.</p>}
        <div className="reunite-members">
          {members.map(m => <article key={m.uid} className={m.uid === selected.uid ? 'current' : ''}>
            <div className="reunite-head"><strong>{m.full_name}</strong><StatusBadge status={m.latest_status} /></div>
            <p className="reunite-muted">{[m.is_head ? 'Household head' : null, m.sex, m.age !== null ? `${m.age} yrs` : null, m.home_barangay].filter(Boolean).join(' · ')}</p>
            <p><Location p={m} /></p>
            {m.open_missing_report && <span className="reunite-badge bad">Reported missing</span>}
          </article>)}
          {household.dependents.map((d, i) => <article key={`dep-${i}`} className="dependent">
            <div className="reunite-head"><strong>{d.name ?? 'Unnamed dependent'}</strong><span className="reunite-badge none">Location unknown</span></div>
            <p className="reunite-muted">{[d.relationship, d.sex, d.birthdate ? `born ${d.birthdate}` : null].filter(Boolean).join(' · ')}</p>
            <p className="reunite-muted">Listed dependent without an account — not tracked by evacuation records. Check with the household head.</p>
          </article>)}
        </div>
      </>}
    </section>}
  </div>
}
