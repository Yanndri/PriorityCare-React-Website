import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import L from 'leaflet'
import { MapContainer, Marker, TileLayer } from 'react-leaflet'
import type { EvacuationCenter, EvacuationCenterResident } from '../types/dashboard'
import { FacilityForm } from '../components/FacilityForm'
import { FacilityLocationPicker } from '../components/FacilityLocationPicker'
import { SidePanel } from '../components/SidePanel'
import { FACILITY_TYPES, facilityTypeLabel, validateCapacity } from '../utils/facility'
import { admitWalkIn, changeFacilityStatus, sendCenterHome, setFacilityCapacity, updateFacilityDetails } from '../api/facilityApi'
import { supabase } from '../lib/supabaseClient'
import { useShowOnMap } from '../lib/showOnMap'
import { elapsed } from '../utils/dispatch'
import './DispatchPage.css'

type EvacCentersPageProps = {
  centers: EvacuationCenter[]
  onReload: () => Promise<void>
  // Set for super admins only: they choose the barangay a new facility belongs to.
  barangayOptions?: { barangay_id: number; barangay_name: string }[]
  // Barangay in scope, so the location map opens there; null = all of Cordova.
  scopeBarangayId?: number | null
}

// Same layout as Operation, Alarms and Missing persons: counters that filter, the centers
// on the left, the chosen center on the right with everyone staying there.
// People are always sent to the nearest open center with space (no shelter plan).

type Group = 'full' | 'near' | 'open' | 'closed'
const GROUPS: { key: Group; title: string; counter: string }[] = [
  { key: 'full', title: 'Full', counter: 'Full' },
  { key: 'near', title: 'Almost full (80% or more)', counter: 'Almost full (80%+)' },
  { key: 'open', title: 'Open with space', counter: 'Open with space' },
  { key: 'closed', title: 'Closed', counter: 'Closed' },
]
const isClosed = (c: EvacuationCenter) => c.status.toLowerCase() === 'closed'
const keyOf = (c: EvacuationCenter) => String(c.id ?? c.name)
const headcount = (people: EvacuationCenterResident[]) => people.reduce((n, r) => n + (r.headcount ?? 1), 0)
const formatTime = (value?: string | null) => value
  ? new Date(value).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  : '—'

function groupOf(c: EvacuationCenter): Group {
  if (isClosed(c)) return 'closed'
  if (!c.capacityConfirmed || !c.capacity) return 'open'
  if (c.occupied >= c.capacity) return 'full'
  return c.occupied / c.capacity >= 0.8 ? 'near' : 'open'
}
const percentOf = (c: EvacuationCenter) => (c.capacity > 0 ? Math.min(100, Math.round((c.occupied / c.capacity) * 100)) : 0)
const spacesLeft = (c: EvacuationCenter) => Math.max(0, c.capacity - c.occupied)
// Names show "· walk-in" / "· family member" from the data; the table shows that as a tag instead.
const plainName = (r: EvacuationCenterResident) => r.name.replace(/ · (walk-in|family member)$/, '')
const KIND_TAG: Record<string, string> = { resident: 'Household head', member: 'Member', walkin: 'Walk-in' }

const pinIcon = L.divIcon({ className: 'facility-pin', html: '<span aria-hidden="true"></span>', iconSize: [26, 26], iconAnchor: [13, 26] })
function CenterMiniMap({ lat, lng }: { lat: number; lng: number }) {
  // A still picture of where the center is; "See on map" opens the full map.
  return <div className="ec-minimap">
    <MapContainer key={`${lat},${lng}`} center={[lat, lng]} zoom={16} dragging={false} zoomControl={false} scrollWheelZoom={false}
      doubleClickZoom={false} touchZoom={false} keyboard={false} attributionControl={false} style={{ width: '100%', height: '100%' }}>
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <Marker position={[lat, lng]} icon={pinIcon} interactive={false} />
    </MapContainer>
  </div>
}

export function EvacCentersPage({ centers, onReload, barangayOptions, scopeBarangayId = null }: EvacCentersPageProps) {
  const showOnMap = useShowOnMap()
  const [query, setQuery] = useState('')
  const [groupFilter, setGroupFilter] = useState<Group | null>(null)
  const [closedOpen, setClosedOpen] = useState(false)
  const [sel, setSel] = useState<string | null>(null)
  const [peopleQuery, setPeopleQuery] = useState('')
  const [panel, setPanel] = useState<null | 'add' | 'walkin' | 'edit' | 'status'>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const needle = query.trim().toLowerCase()
  const personHits = (c: EvacuationCenter) => (needle ? (c.residents ?? []).filter((r) => r.name.toLowerCase().includes(needle)) : [])
  const matches = (c: EvacuationCenter) => !needle || c.name.toLowerCase().includes(needle)
    || (c.barangayName ?? '').toLowerCase().includes(needle) || personHits(c).length > 0

  const counts: Record<Group, number> = { full: 0, near: 0, open: 0, closed: 0 }
  centers.forEach((c) => { counts[groupOf(c)] += 1 })
  const staying = centers.filter((c) => !isClosed(c)).reduce((n, c) => n + c.occupied, 0)
  const groups = GROUPS.map((g) => ({
    ...g,
    list: (groupFilter && groupFilter !== g.key) ? [] : centers.filter((c) => groupOf(c) === g.key && matches(c))
      .sort((a, b) => percentOf(b) - percentOf(a) || a.name.localeCompare(b.name)),
  }))
  const shown = groups.flatMap((g) => g.list)
  const selected = centers.find((c) => keyOf(c) === sel) ?? groups.filter((g) => g.key !== 'closed').flatMap((g) => g.list)[0] ?? shown[0]
  const showClosed = closedOpen || groupFilter === 'closed' || !!needle

  function pick(c: EvacuationCenter) {
    setSel(keyOf(c)); setPeopleQuery(needle && personHits(c).length ? query.trim() : ''); setNotice(''); setError('')
    if (window.innerWidth < 1000) setTimeout(() => document.getElementById('ec-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
  }

  // "Went home" keeps the records (audit trail); people just stop counting at the center.
  async function wentHome(center: EvacuationCenter, person?: EvacuationCenterResident) {
    const question = person
      ? `Mark ${plainName(person)} as went home?`
      : `Mark everyone at ${center.name} as went home? Use this when the disaster is over.`
    if (center.id === undefined || !window.confirm(question)) return
    setBusy(true); setError(''); setNotice('')
    try {
      const n = await sendCenterHome(center.id, person ? String(person.id) : undefined)
      await onReload()
      setNotice(person ? `${plainName(person)} marked as went home.` : `${n} ${n === 1 ? 'person' : 'people'} marked as went home.`)
    } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.') }
    finally { setBusy(false) }
  }

  function renderRow(c: EvacuationCenter) {
    const g = groupOf(c)
    const isSel = selected && keyOf(selected) === keyOf(c)
    const hits = personHits(c)
    const sub = hits.length
      ? `${hits.slice(0, 2).map(plainName).join(', ')}${hits.length > 2 ? ` +${hits.length - 2}` : ''} ${hits.length === 1 ? 'is' : 'are'} here`
      : `${c.facilityType ? facilityTypeLabel(c.facilityType) : 'Evacuation center'} · ${c.barangayName ?? 'Municipal'}`
    return <li key={keyOf(c)}>
      <button type="button" className={`op-row ec-row ec-${g}${isSel ? ' is-selected' : ''}${g === 'closed' ? ' is-closed' : ''}`}
        aria-current={isSel ? 'true' : undefined} onClick={() => pick(c)}>
        <span className="op-row-main">
          <strong>{c.name}</strong>
          {g !== 'closed' && c.capacityConfirmed ? <span className="ec-bar" aria-hidden="true"><i style={{ width: `${percentOf(c)}%` }} /></span> : null}
          <span className="op-row-sub">{sub}</span>
        </span>
        <span className="op-row-side"><span className="ec-num">{g === 'closed' ? 'Closed' : c.capacityConfirmed ? `${c.occupied} / ${c.capacity}` : `${c.occupied}`}</span></span>
      </button>
    </li>
  }

  function renderDetail(c: EvacuationCenter) {
    const g = groupOf(c)
    const people = c.residents ?? []
    const pq = peopleQuery.trim().toLowerCase()
    const listed = people.filter((r) => !pq || r.name.toLowerCase().includes(pq) || r.barangay.toLowerCase().includes(pq))
    const rescued = people.filter((r) => r.rescued).reduce((n, r) => n + (r.headcount ?? 1), 0)
    const walkins = people.filter((r) => r.kind === 'walkin').reduce((n, r) => n + (r.headcount ?? 1), 0)
    const own = headcount(people) - rescued
    const hasMap = Number.isFinite(c.gpsLat) && Number.isFinite(c.gpsLong) && !(c.gpsLat === 0 && c.gpsLong === 0)
    const canEdit = c.editable !== false
    const badge = g === 'closed' ? <span className="op-pill pill-grey">Closed</span>
      : g === 'full' ? <span className="op-pill pill-sos">Full</span>
      : g === 'near' ? <span className="op-pill pill-wait">Almost full</span>
      : <span className="op-pill pill-safe">Open</span>
    return <>
      <div className="op-detail-head">
        <h3>{c.name} {badge}</h3>
        <p className="dispatch-muted">
          {c.barangayName ?? 'Municipal (all barangays)'}
          {g !== 'closed' && c.capacityConfirmed ? ` · ${spacesLeft(c)} space${spacesLeft(c) === 1 ? '' : 's'} left` : ''}
        </p>
      </div>
      <div className={`op-detail-body${hasMap ? '' : ' ec-nomap'}`}>
        <dl className="op-facts">
          {g === 'closed'
            ? <><dt>Closed</dt><dd>{c.closedAt ? formatTime(c.closedAt) : '—'}{c.closureReason ? `: ${c.closureReason}` : ''}</dd></>
            : <><dt>Staying</dt><dd>{c.occupied}{c.capacityConfirmed ? ` of ${c.capacity}` : ''} people{c.households ? ` · ${c.households} household${c.households === 1 ? '' : 's'}` : ''}</dd>
              {people.length > 0 && <><dt>Came how</dt><dd>{rescued} rescued · {own} on their own{walkins ? ` (${walkins} walk-in${walkins === 1 ? '' : 's'})` : ''}</dd></>}</>}
          <dt>Type</dt><dd>{c.facilityType ? facilityTypeLabel(c.facilityType) : 'Evacuation center'}</dd>
          <dt>Room for</dt><dd>{c.capacityConfirmed ? `${c.capacity} people` : 'Not set yet'}</dd>
          <dt>Location</dt><dd>{hasMap ? <>{c.gpsLat?.toFixed(5)}, {c.gpsLong?.toFixed(5)}
            {showOnMap && <> · <button type="button" className="link-button" onClick={() => showOnMap({ lat: c.gpsLat as number, lng: c.gpsLong as number, label: c.name })}>See on map</button></>}</> : 'Not set'}</dd>
        </dl>
        {hasMap && <CenterMiniMap lat={c.gpsLat as number} lng={c.gpsLong as number} />}
      </div>

      {!canEdit && <p className="dispatch-muted">View only: managed by {c.barangayName ? `Barangay ${c.barangayName}` : 'the municipal admin'}.</p>}
      {g !== 'closed' && (g === 'full'
        ? <p className="op-next-note">This center is full. Check people in at another center.</p>
        : <button type="button" className="op-next" onClick={() => setPanel('walkin')}>+ Check in people (walk-in)</button>)}
      {canEdit && <div className="op-small">
        <button type="button" className="secondary-button" onClick={() => setPanel('edit')}>Edit details</button>
        {g !== 'closed' && c.occupied > 0 && <button type="button" className="secondary-button" disabled={busy} onClick={() => void wentHome(c)}>Everyone went home</button>}
        <button type="button" className={g === 'closed' ? 'secondary-button' : 'danger-button'} onClick={() => setPanel('status')}>{g === 'closed' ? 'Reopen center' : 'Close center'}</button>
      </div>}

      {g !== 'closed' && <section className="ec-people" aria-label="People staying here">
        <div className="ec-people-head">
          <strong>People staying here ({headcount(people)})</strong>
          {people.length > 0 && <input type="search" placeholder="Search by name or barangay…" aria-label="Search people in this center" value={peopleQuery} onChange={(e) => setPeopleQuery(e.target.value)} />}
        </div>
        {people.length === 0 ? <p className="dispatch-muted op-empty">No one is checked in here yet.</p>
          : listed.length === 0 ? <p className="dispatch-muted op-empty">No one here matches "{peopleQuery.trim()}".</p>
          : <div className="ec-table-wrap"><table className="ec-table">
            <thead><tr><th>Name</th><th>From</th><th>How they came</th><th>Since</th>{canEdit && <th><span className="visually-hidden">Actions</span></th>}</tr></thead>
            <tbody>{listed.map((r) => <tr key={String(r.id)}>
              <td><strong>{plainName(r)}</strong>{(r.headcount ?? 1) > 1 && ` (${r.headcount})`} {r.kind && <span className={`op-pill ${r.kind === 'resident' ? 'pill-step' : 'pill-grey'}`}>{KIND_TAG[r.kind]}</span>}</td>
              <td>{r.barangay}{r.sitio ? ` · ${r.sitio}` : ''}</td>
              <td>{r.rescued ? 'Rescued' : 'On their own'}</td>
              <td title={formatTime(r.since)}>{r.since ? `${elapsed(r.since)} ago` : '—'}</td>
              {canEdit && <td><button type="button" className="link-button" disabled={busy} onClick={() => void wentHome(c, r)}>Went home</button></td>}
            </tr>)}</tbody>
          </table></div>}
      </section>}
    </>
  }

  return <div className="dispatch-page ec-page">
    <section className="panel dispatch-top">
      <div className="dispatch-head">
        <div><h3>Evacuation centers</h3>
          <p className="dispatch-muted">People are sent to the nearest open center with space. Choose a center to see who is staying there.</p></div>
        <div className="ticket-actions"><button type="button" className="primary-button" onClick={() => setPanel('add')}>+ Add a center</button></div>
      </div>
      <div className="op-toolbar">
        <input type="search" className="op-search" placeholder="Find a center or a person staying in one…" aria-label="Find a center or a person" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="op-counters" role="group" aria-label="Show only">
        {GROUPS.map((g) => <button key={g.key} type="button" className={`op-counter${groupFilter === g.key ? ' is-on' : ''}`}
          aria-pressed={groupFilter === g.key} onClick={() => setGroupFilter((f) => (f === g.key ? null : g.key))}>
          <strong className={g.key === 'full' && counts.full ? 'bad' : g.key === 'near' && counts.near ? 'warn' : ''}>{counts[g.key]}</strong>
          <span>{g.counter}</span></button>)}
        <div className="op-counter ec-stat"><strong>{staying}</strong><span>People staying now</span></div>
      </div>
      {error && <p role="alert" className="dispatch-error">{error}</p>}
      {notice && <p role="status" className="dispatch-notice">{notice}</p>}
    </section>

    <div className="op-split">
      <section className="panel op-list" aria-label="Centers">
        {needle && !shown.length && <p className="dispatch-muted op-empty">No center or person matches "{query.trim()}".</p>}
        {!centers.length && <p className="dispatch-muted op-empty">No evacuation centers yet. Add one with "+ Add a center".</p>}
        {groups.map((g) => {
          if (g.key === 'closed') return g.list.length || (!needle && counts.closed) ? <div key={g.key}>
            <button type="button" className="op-group op-group-toggle" aria-expanded={showClosed} onClick={() => setClosedOpen((o) => !o)}>
              {g.title} ({g.list.length}) {showClosed ? '▾' : '▸'}</button>
            {showClosed && <ul>{g.list.map(renderRow)}</ul>}
          </div> : null
          if (!g.list.length) return groupFilter === g.key ? <div key={g.key}><h4 className="op-group">{g.title} (0)</h4><p className="dispatch-muted op-empty">Nothing here right now.</p></div> : null
          return <div key={g.key}><h4 className="op-group">{g.title} ({g.list.length})</h4><ul>{g.list.map(renderRow)}</ul></div>
        })}
      </section>
      <section id="ec-detail" className="panel op-detail" aria-live="polite">
        {selected ? renderDetail(selected) : <p className="dispatch-muted op-empty">Pick a center on the left to see the details.</p>}
      </section>
    </div>

    {panel === 'add' && <FacilityForm center={null} existingCenters={centers} barangayOptions={barangayOptions} scopeBarangayId={scopeBarangayId} onClose={() => setPanel(null)} onSaved={onReload} />}
    {panel === 'walkin' && selected && <WalkInPanel center={selected} centers={centers} fallbackBarangays={barangayOptions}
      onClose={() => setPanel(null)} onDone={async (msg) => { setPanel(null); setNotice(msg); await onReload() }} />}
    {panel === 'edit' && selected && <EditCenterPanel center={selected} centers={centers} scopeBarangayId={scopeBarangayId}
      onClose={() => setPanel(null)} onDone={async (msg) => { setPanel(null); setNotice(msg); await onReload() }} />}
    {panel === 'status' && selected && <StatusPanel center={selected} busy={busy} onEveryoneHome={() => wentHome(selected)}
      onClose={() => setPanel(null)} onDone={async (msg) => { setPanel(null); setNotice(msg); await onReload() }} />}
  </div>
}

// ------------------------------------------------------------------ check in people (walk-in)
// Same form as the responder app: one name per person, so a family can find them.
function WalkInPanel({ center, centers, fallbackBarangays, onClose, onDone }: {
  center: EvacuationCenter; centers: EvacuationCenter[]; fallbackBarangays?: { barangay_id: number; barangay_name: string }[]
  onClose: () => void; onDone: (message: string) => Promise<void>
}) {
  const OUTSIDE = 'outside'
  const [barangays, setBarangays] = useState(fallbackBarangays ?? [])
  const [people, setPeople] = useState([''])
  const [from, setFrom] = useState<string>('')
  const [sitio, setSitio] = useState('')
  const [needs, setNeeds] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    // Walk-ins can come from any barangay of Cordova.
    let cancelled = false
    supabase.from('barangays').select('barangay_id, barangay_name').order('barangay_name')
      .then(({ data }) => { if (!cancelled && data?.length) setBarangays(data as { barangay_id: number; barangay_name: string }[]) })
    return () => { cancelled = true }
  }, [])
  const names = people.map((n) => n.trim().replace(/\s+/g, ' ')).filter(Boolean)
  const free = spacesLeft(center)
  const tooMany = !!center.capacityConfirmed && names.length > free
  const others = centers.filter((c) => !isClosed(c) && c.id !== center.id && spacesLeft(c) >= names.length).slice(0, 3)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (center.id == null) return
    if (!names.length) { setError('Type the name of at least one person.'); return }
    if (!from) { setError('Choose where they are from, or "Outside Cordova / not sure".'); return }
    setBusy(true); setError('')
    const failed: string[] = []
    let firstError = ''
    for (let k = 0; k < names.length; k += 1) {
      try {
        await admitWalkIn({ centerId: center.id, name: names[k], barangayId: from === OUTSIDE ? null : Number(from), sitio,
          // The note is saved once, with the first person, so needs are not counted twice.
          needs: k === 0 ? needs : '' })
      } catch (e) { failed.push(names[k]); if (!firstError) firstError = e instanceof Error ? e.message : 'Could not check in.' }
    }
    setBusy(false)
    if (failed.length) {
      setPeople(failed)
      setError(`${names.length - failed.length ? `${names.length - failed.length} checked in. ` : ''}Not checked in: ${failed.join(', ')}. ${firstError}`)
      return
    }
    await onDone(`${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} checked in at ${center.name}.`)
  }

  return <SidePanel title={`Check in people at ${center.name}`} onClose={onClose} error={error} busy={busy}>
    <form onSubmit={submit} className="ec-form">
      <p className="dispatch-muted">People who came on their own. Add each person by name, so their family can find them.</p>
      <fieldset disabled={busy} className="ec-fieldset">
        <legend>Who came? One name per person</legend>
        <p className="ec-hint">First and last name. A child with no known first name can be "Baby Santos".</p>
        {people.map((n, k) => <div key={k} className="ec-person">
          <input aria-label={`Person ${k + 1} full name`} placeholder={`Person ${k + 1}: full name`} maxLength={200} value={n}
            onChange={(e) => setPeople((list) => list.map((x, i) => (i === k ? e.target.value : x)))} />
          {people.length > 1 && <button type="button" className="secondary-button" aria-label={`Remove person ${k + 1}`}
            onClick={() => setPeople((list) => list.filter((_, i) => i !== k))}>✕</button>}
        </div>)}
        <button type="button" className="link-button" disabled={people.length >= 30} onClick={() => setPeople((list) => [...list, ''])}>+ Add another person</button>
      </fieldset>
      <fieldset disabled={busy} className="ec-fieldset">
        <legend>Where are they from?</legend>
        <div className="ec-chips">
          {[...barangays.map((b) => ({ id: String(b.barangay_id), name: b.barangay_name })), { id: OUTSIDE, name: 'Outside Cordova / not sure' }].map((b) =>
            <button key={b.id} type="button" className={`ec-chip${from === b.id ? ' is-on' : ''}`} aria-pressed={from === b.id} onClick={() => setFrom(b.id)}>{b.name}</button>)}
        </div>
        <label>Sitio or landmark (optional)<input maxLength={100} value={sitio} onChange={(e) => setSitio(e.target.value)} /></label>
        <label>Anything the center should know? (optional)<input maxLength={500} placeholder="e.g. a senior, uses a wheelchair, an infant" value={needs} onChange={(e) => setNeeds(e.target.value)} /></label>
      </fieldset>
      {tooMany && <p className="op-next-note">{center.name} has only {free} space{free === 1 ? '' : 's'} left.
        {others.length ? ` Centers with room: ${others.map((c) => `${c.name} (${spacesLeft(c)})`).join(', ')}.` : ''}</p>}
      <div className="row-actions">
        <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button>
        <button type="submit" className="primary-button" disabled={busy || !names.length || tooMany}>
          {busy ? 'Checking in…' : names.length > 1 ? `Check in ${names.length} people` : 'Check in'}</button>
      </div>
    </form>
  </SidePanel>
}

// ------------------------------------------------------------------ edit details
function EditCenterPanel({ center, centers, scopeBarangayId, onClose, onDone }: {
  center: EvacuationCenter; centers: EvacuationCenter[]; scopeBarangayId: number | null
  onClose: () => void; onDone: (message: string) => Promise<void>
}) {
  const [name, setName] = useState(center.name)
  const [type, setType] = useState<string>(center.facilityType && (FACILITY_TYPES as readonly string[]).includes(center.facilityType) ? center.facilityType : 'other')
  const [capacity, setCapacity] = useState(center.capacityConfirmed ? String(center.capacity) : '')
  const [lat, setLat] = useState(Number.isFinite(center.gpsLat) && center.gpsLat ? String(center.gpsLat) : '')
  const [lng, setLng] = useState(Number.isFinite(center.gpsLong) && center.gpsLong ? String(center.gpsLong) : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const detailsChanged = name.trim() !== center.name || type !== (center.facilityType ?? 'other')
    || lat !== (center.gpsLat ? String(center.gpsLat) : '') || lng !== (center.gpsLong ? String(center.gpsLong) : '')
  const capacityChanged = capacity.trim() !== (center.capacityConfirmed ? String(center.capacity) : '')

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (center.id == null) return
    if (!name.trim()) { setError('Enter the center\'s name.'); return }
    if (!lat || !lng) { setError('Click the map to set where the center is.'); return }
    const cap = Number(capacity)
    const capError = validateCapacity(cap)
    if (capError) { setError(capError); return }
    if (cap < center.occupied) { setError(`Room for can't be less than the ${center.occupied} people staying now.`); return }
    setBusy(true); setError('')
    try {
      if (detailsChanged) await updateFacilityDetails(center.id, { name, type, latitude: Number(lat), longitude: Number(lng) })
      if (capacityChanged) await setFacilityCapacity(center.id, cap, center.capacityConfirmed ? center.capacity : null)
      await onDone(detailsChanged || capacityChanged ? `${name.trim()} saved.` : 'Nothing changed.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save the center.') }
    finally { setBusy(false) }
  }

  return <SidePanel title={`Edit ${center.name}`} onClose={onClose} error={error} busy={busy}>
    <form onSubmit={submit} className="ec-form">
      <fieldset disabled={busy} className="ec-fieldset ec-plain">
        <label>Name<input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <div className="ec-two">
          <label>Type<select value={type} onChange={(e) => setType(e.target.value)}>
            {FACILITY_TYPES.map((t) => <option key={t} value={t}>{t === 'makeshift' ? 'Temporary evacuation center (this disaster only)' : facilityTypeLabel(t)}</option>)}</select></label>
          <label>Room for (people)<input required type="number" min={Math.max(1, center.occupied)} max={1_000_000} step={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} /></label>
        </div>
        {center.occupied > 0 && <p className="ec-hint">{center.occupied} people are staying now, so room for can't go lower than that.</p>}
        <div className="ec-picker">
          <span className="ec-label">Location</span>
          <FacilityLocationPicker latitude={lat} longitude={lng} centers={centers} excludeId={center.id} pinLabel={center.name}
            focusBarangayId={center.barangayId ?? scopeBarangayId} disabled={busy} onChange={(a, b) => { setLat(a); setLng(b) }} />
        </div>
      </fieldset>
      <div className="row-actions">
        <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button>
        <button type="submit" className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
      </div>
    </form>
  </SidePanel>
}

// ------------------------------------------------------------------ close / reopen
const CLOSE_REASONS = ['Disaster is over', 'Damaged or unsafe', 'Other']
const REOPEN_REASONS = ['New disaster', 'Repaired and safe', 'Other']
function StatusPanel({ center, busy: pageBusy, onEveryoneHome, onClose, onDone }: {
  center: EvacuationCenter; busy: boolean; onEveryoneHome: () => Promise<void>
  onClose: () => void; onDone: (message: string) => Promise<void>
}) {
  const reopening = isClosed(center)
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inside = center.occupied
  const full = useMemo(() => [reason, note.trim()].filter(Boolean).join(': '), [reason, note])
  const blocked = !reopening && inside > 0

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (center.id == null || !reason || blocked) return
    if (reason === 'Other' && !note.trim()) { setError('Write a short reason.'); return }
    setBusy(true); setError('')
    try {
      await changeFacilityStatus(center.id, reopening ? 'active' : 'closed', full, reopening ? 'closed' : 'active')
      await onDone(reopening ? `${center.name} is open again.` : `${center.name} is closed. Its records are kept.`)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not change the center.') }
    finally { setBusy(false) }
  }

  const chips: ReactNode = (reopening ? REOPEN_REASONS : CLOSE_REASONS).map((r) =>
    <button key={r} type="button" className={`ec-chip${reason === r ? ' is-on' : ''}`} aria-pressed={reason === r} onClick={() => setReason(r)}>{r}</button>)

  return <SidePanel title={reopening ? `Reopen ${center.name}?` : `Close ${center.name}?`} onClose={onClose} error={error} busy={busy}>
    <form onSubmit={submit} className="ec-form">
      {blocked && <div className="op-next-note">
        {inside} {inside === 1 ? 'person is' : 'people are'} still staying here. Mark them as went home first, or check them in at another center.
        <div className="op-small"><button type="button" className="secondary-button" disabled={pageBusy} onClick={() => void onEveryoneHome()}>Everyone went home</button></div>
      </div>}
      <p className="dispatch-muted">{reopening
        ? 'It will be offered again as the nearest center with space. Check that its room for is still right.'
        : 'While it is closed, no one can be checked in here and it is not offered as the nearest center. Its records are kept, and you can reopen it any time.'}</p>
      <fieldset disabled={busy || blocked} className="ec-fieldset">
        <legend>{reopening ? 'Why are you reopening it?' : 'Why are you closing it?'}</legend>
        <div className="ec-chips">{chips}</div>
        <label>Note {reason === 'Other' ? '(required)' : '(optional)'}<input maxLength={900} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      </fieldset>
      <div className="row-actions">
        <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button>
        <button type="submit" className={reopening ? 'primary-button' : 'danger-button'} disabled={busy || blocked || !reason}>
          {busy ? 'Saving…' : reopening ? 'Reopen center' : 'Close center'}</button>
      </div>
    </form>
  </SidePanel>
}
