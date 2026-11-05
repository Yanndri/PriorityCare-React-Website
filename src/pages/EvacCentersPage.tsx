import { useState } from 'react'
import type { EvacuationCenter } from '../types/dashboard'
import { FacilityForm } from '../components/FacilityForm'
import { facilityTypeLabel } from '../utils/facility'
import { ReliefDemandPlanner } from '../components/ReliefDemandPlanner'
import { FacilityLifecycleForm } from '../components/FacilityLifecycleForm'
import { ShelterCatchmentPanel } from '../components/ShelterCatchmentPanel'
import { SubTabs } from '../components/SubTabs'
import { sendCenterHome } from '../api/facilityApi'

type EvacCentersPageProps = {
  centers: EvacuationCenter[]
  onReload: () => Promise<void>
  // Set for super admins only: they choose the barangay a new facility belongs to.
  barangayOptions?: { barangay_id: number; barangay_name: string }[]
  // Barangay in scope, so the location map opens there; null = all of Cordova.
  scopeBarangayId?: number | null
}

// Three tabs: the centers themselves, which shelter each barangay uses,
// and the relief supplies the centers need.
export function EvacCentersPage(props: EvacCentersPageProps) {
  return (
    <SubTabs
      label="Evacuation centers"
      parts={[
        { key: 'centers', label: 'Centers', content: <CentersList {...props} /> },
        { key: 'plan', label: 'Shelter plan', content: <ShelterCatchmentPanel /> },
        { key: 'relief', label: 'Relief supplies', content: <ReliefDemandPlanner centers={props.centers} /> },
      ]}
    />
  )
}

const isClosed = (c: EvacuationCenter) => c.status.toLowerCase() === 'closed'

function CentersList({ centers, onReload, barangayOptions, scopeBarangayId = null }: EvacCentersPageProps) {
  const [search, setSearch] = useState('')
  const [showClosed, setShowClosed] = useState(false)
  const [form, setForm] = useState<{ center: EvacuationCenter | null } | null>(null)
  const [statusCenter, setStatusCenter] = useState<EvacuationCenter | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // "Went home" keeps the records (audit trail); people just stop counting at the center.
  async function wentHome(center: EvacuationCenter, person?: { id: number | string; name: string }) {
    const question = person
      ? `Mark ${person.name} as went home?`
      : `Mark everyone at ${center.name} as went home? Use this when the disaster is over. The center can then be closed.`
    if (center.id === undefined || !window.confirm(question)) return
    setBusy(true); setError('')
    try { await sendCenterHome(center.id, person ? String(person.id) : undefined); await onReload() }
    catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.') }
    finally { setBusy(false) }
  }

  // Search matches a center's name or anyone staying in it.
  const q = search.trim().toLowerCase()
  const closedCount = centers.filter(isClosed).length
  const shown = centers
    .filter(c => showClosed || !isClosed(c))
    .filter(c => !q || c.name.toLowerCase().includes(q) || (c.residents ?? []).some(r => r.name.toLowerCase().includes(q)))

  return (
    <section>
      <div className="evac-toolbar">
        <input type="search" placeholder="Search a center or a person's name" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search" />
        <label className="resident-check">
          <input type="checkbox" checked={showClosed} onChange={e => setShowClosed(e.target.checked)} />
          <span>Show closed ({closedCount})</span>
        </label>
        <button type="button" className="verify-button" onClick={() => setForm({ center: null })}>Add a center</button>
      </div>

      {error && <p role="alert" className="dashboard-error">{error}</p>}
      {shown.length === 0 && <p className="empty-documents">No evacuation centers found.</p>}

      <div className="evac-grid">
        {shown.map(center => {
          const known = Boolean(center.capacityConfirmed && center.occupancyKnown)
          const percent = known && center.capacity > 0 ? Math.min(100, Math.round((center.occupied / center.capacity) * 100)) : 0
          const full = known && center.occupied >= center.capacity
          const label = isClosed(center) ? 'Closed' : full ? 'Full' : 'Open'
          const people = center.residents ?? []
          return (
            <article className="evac-card" key={center.id ?? center.name}>
              <div className="evac-card-head">
                <strong>{center.name}</strong>
                <span className={`evac-badge evac-${label.toLowerCase()}`}>{label}</span>
              </div>
              <p className="evac-sub">
                {center.facilityType ? facilityTypeLabel(center.facilityType) : 'Evacuation center'}
                {center.barangayId !== undefined && ` · ${center.barangayName ?? 'Municipal (all barangays)'}`}
              </p>

              {isClosed(center) ? (
                <p className="evac-sub">Closed{center.closedAt ? ` ${new Date(center.closedAt).toLocaleDateString()}` : ''}{center.closureReason ? `: ${center.closureReason}` : ''}</p>
              ) : known ? (
                <>
                  <div className="progress-track"><div className="progress-fill" style={{ width: `${percent}%` }} /></div>
                  <p className="evac-count"><strong>{center.occupied}</strong> of {center.capacity} people{full ? '' : ` · ${center.capacity - center.occupied} spaces left`}</p>
                </>
              ) : (
                <p className="evac-sub">{center.capacityConfirmed ? `Room for ${center.capacity} people` : 'Capacity not set yet'}</p>
              )}

              <details className="evac-people">
                <summary>People here ({people.reduce((n, r) => n + (r.headcount ?? 1), 0)})</summary>
                {people.length === 0 ? <p className="evac-sub">No one has checked in yet.</p> : (
                  <ul>{people.map(r => (
                    <li key={`${center.id ?? center.name}-${r.id}`}>
                      <span>{r.name}</span>
                      <small>
                        {r.barangay} · <span className={r.rescued ? 'evac-rescued' : 'evac-self'}>{r.rescued ? 'Rescued' : 'Came on their own'}</span>
                        {center.editable !== false && <button type="button" className="link-button" disabled={busy} onClick={() => void wentHome(center, r)}>Went home</button>}
                      </small>
                    </li>
                  ))}</ul>
                )}
              </details>

              {center.editable === false ? (
                <p className="evac-sub">View only: managed by {center.barangayName ? `Barangay ${center.barangayName}` : 'the municipal admin'}.</p>
              ) : (
                <div className="evac-actions">
                  <button type="button" className="secondary-button" onClick={() => setForm({ center })}>Edit</button>
                  {!isClosed(center) && center.occupied > 0 && (
                    <button type="button" className="secondary-button" disabled={busy} onClick={() => void wentHome(center)}>Everyone went home</button>
                  )}
                  <button type="button" className="secondary-button" onClick={() => setStatusCenter(center)}>{isClosed(center) ? 'Reopen' : 'Close'}</button>
                </div>
              )}
            </article>
          )
        })}
      </div>

      {form && <FacilityForm key={String(form.center?.id ?? 'new')} center={form.center} existingCenters={centers} barangayOptions={barangayOptions} scopeBarangayId={scopeBarangayId} onClose={() => setForm(null)} onSaved={onReload} />}
      {statusCenter && <FacilityLifecycleForm key={statusCenter.id ?? statusCenter.name} center={statusCenter} onClose={() => setStatusCenter(null)} onSaved={onReload} />}
    </section>
  )
}
