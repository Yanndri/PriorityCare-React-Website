import { SidePanel } from '../components/SidePanel'
import { useEffect, useMemo, useState } from 'react'
import { useLiveSignal } from '../lib/useLiveSignal'
import { useScopeBarangay } from '../lib/scope'
import type { FormEvent, ReactNode } from 'react'
import { supabase } from '../lib/supabaseClient'
import { createDispatchTicket } from '../api/dispatchApi'
import { elapsed, STATUS_LABELS, type TicketStatus } from '../utils/dispatch'
import './DispatchPage.css'
import {
  fileMissingPersonReport, getRescueReconciliation, markMissingPersonFound, withdrawMissingPersonReport,
} from '../api/missingPersonsApi'
import {
  ageOn, fullName, matchLabels, reconcile, reconciliationCsv, statusLabels,
} from '../utils/rescueReconciliation'
import type { MatchCandidate, MissingPersonReport, ReconciledReport, ReconciliationData, RegistryResident } from '../utils/rescueReconciliation'
import './RescueReconciliationPage.css'

const formatTime = (value: string | null) => value
  ? new Date(value).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })
  : '—'

const emptyForm = {
  barangay: '', event: '', resident: '', name: '', sex: '', age: '', where: '', when: '',
  reporter: '', contact: '', notes: '',
}

type Closing = { reportId: string; mode: 'elsewhere' | 'withdraw' } | null

// One list, grouped by what to do next (same layout as Operation and Alarms).
type Group = 'maybe' | 'missing' | 'unaccounted' | 'safe' | 'closed'
type Item =
  | { kind: 'report'; key: string; o: ReconciledReport; group: Group; at: string | null }
  | { kind: 'resident'; key: string; r: RegistryResident; group: Group; at: string | null }
  | { kind: 'closed'; key: string; c: MissingPersonReport; group: Group; at: string | null }
const GROUPS: { key: Group; title: string; counter: string }[] = [
  { key: 'maybe', title: 'May be found, check the match', counter: 'May be found (check)' },
  { key: 'missing', title: 'Still missing', counter: 'Still missing' },
  { key: 'unaccounted', title: 'Not checked in, not reported', counter: 'Not checked in, not reported' },
  { key: 'safe', title: 'Safely evacuated', counter: 'Safely evacuated' },
  { key: 'closed', title: 'Closed', counter: 'Closed' },
]
type SearchTicket = { ticket_no: number; source_ref: string; status: TicketStatus }

export function RescueReconciliationPage({ onOpenRequests }: { onOpenRequests?: () => void } = {}) {
  const [rawData, setData] = useState<ReconciliationData | null>(null)
  // Only the barangay chosen in the Scope selector (all of them for "All barangays").
  const scope = useScopeBarangay()
  const data = useMemo(() => (rawData && scope != null ? {
    ...rawData,
    barangays: rawData.barangays.filter((b) => b.barangay_id === scope),
    events: rawData.events.filter((e) => e.barangay_id === scope),
    reports: rawData.reports.filter((r) => r.barangay_id === scope),
    residents: rawData.residents.filter((r) => r.barangay_id === scope),
  } : rawData), [rawData, scope])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [closing, setClosing] = useState<Closing>(null)
  const [closingText, setClosingText] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [sel, setSel] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [groupFilter, setGroupFilter] = useState<Group | null>(null)
  const [closedOpen, setClosedOpen] = useState(false)
  const [otherMatches, setOtherMatches] = useState(false)
  // Search requests already made from a report (rescue requests with source "missing person").
  const [searches, setSearches] = useState<Map<string, SearchTicket>>(new Map())
  async function loadSearches(ids: string[]) {
    if (!ids.length) return
    const { data: rows, error: err } = await supabase.from('dispatch_tickets').select('ticket_no, source_ref, status')
      .eq('source', 'missing_report').in('source_ref', ids).not('status', 'in', '(resolved,cancelled)')
    if (err) return
    setSearches((m) => { const next = new Map(m); (rows ?? []).forEach((t) => next.set(String(t.source_ref), t as SearchTicket)); return next })
  }

  async function load() {
    setLoading(true); setError('')
    try { setData(await getRescueReconciliation()) }
    catch (e) { setData(null); setError(e instanceof Error ? e.message : 'Could not load the missing persons list.') }
    finally { setLoading(false) }
  }
  useEffect(() => {
    let cancelled = false
    getRescueReconciliation().then(d => { if (!cancelled) setData(d) })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the missing persons list.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  // Missing reports, check-ins and rescues from the app show up without a Refresh.
  useLiveSignal(['missing', 'evacuation', 'events', 'sos', 'tickets'], () => {
    getRescueReconciliation().then(setData).catch(() => { /* keep what is shown */ })
  })

  const result = useMemo(() => data ? reconcile(data) : null, [data])
  useEffect(() => {
    const ids = (result?.open ?? []).map((o) => o.report.report_id)
    if (!ids.length) return
    let cancelled = false
    supabase.from('dispatch_tickets').select('ticket_no, source_ref, status')
      .eq('source', 'missing_report').in('source_ref', ids).not('status', 'in', '(resolved,cancelled)')
      .then(({ data: rows, error: err }) => {
        if (cancelled || err) return
        setSearches(new Map((rows ?? []).map((t) => [String(t.source_ref), t as SearchTicket])))
      })
    return () => { cancelled = true }
  }, [result])
  const barangayName = (id: number) => data?.barangays.find(s => s.barangay_id === id)?.barangay_name ?? `Barangay ${id}`
  const formBarangay = Number(form.barangay || data?.barangays[0]?.barangay_id || 0)
  const barangayResidents = (data?.residents ?? []).filter(r => r.barangay_id === formBarangay)
  const barangayEvents = (data?.events ?? []).filter(e => e.barangay_id === formBarangay && e.status === 'active')
  const set = (field: keyof typeof emptyForm) => (e: { target: { value: string } }) =>
    setForm(f => ({ ...f, [field]: e.target.value }))

  function pickResident(uid: string) {
    const r = data?.residents.find(x => x.uid === uid)
    setForm(f => r ? {
      ...f, resident: uid, name: fullName(r),
      sex: r.sex === 'male' || r.sex === 'female' ? r.sex : '',
      age: String(ageOn(r.birthdate, new Date()) ?? ''),
    } : { ...f, resident: '' })
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setNotice('')
    const age = form.age.trim() ? Number(form.age) : null
    if (age !== null && (!Number.isInteger(age) || age < 0 || age > 130)) { setError('Enter an age from 0 to 130, or leave it blank.'); return }
    let lastSeenAt: string | null = null
    if (form.when) {
      const t = new Date(`${form.when}:00+08:00`)
      if (!Number.isFinite(t.getTime()) || t.getTime() > Date.now()) { setError('Last-seen time cannot be in the future (Philippine time).'); return }
      lastSeenAt = t.toISOString()
    }
    setBusy(true)
    try {
      await fileMissingPersonReport({
        barangayId: formBarangay, eventId: form.event || null, residentUid: form.resident || null,
        fullName: form.name, sex: form.sex === 'male' || form.sex === 'female' ? form.sex : null, approxAge: age,
        lastSeenLocation: form.where, lastSeenAt, reporterName: form.reporter, reporterContact: form.contact, notes: form.notes,
      })
      setForm({ ...emptyForm, barangay: form.barangay })
      setShowForm(false)
      setNotice('Missing-person report added.'); await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to file the report.') }
    finally { setBusy(false) }
  }

  async function confirmMatch(o: ReconciledReport, residentUid: string) {
    const r = data?.residents.find(x => x.uid === residentUid)
    if (!r || !window.confirm(`Confirm that "${o.report.full_name}" is ${fullName(r)}, safely evacuated at ${r.center_name ?? 'an evacuation center'}? This closes the report as found.`)) return
    setBusy(true); setError(''); setNotice('')
    try {
      await markMissingPersonFound(o.report.report_id, residentUid, '')
      setNotice(`${o.report.full_name} reconciled as found.`); await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to confirm the match.') }
    finally { setBusy(false) }
  }

  async function finishClosing(event: FormEvent) {
    event.preventDefault()
    if (!closing) return
    setBusy(true); setError(''); setNotice('')
    try {
      if (closing.mode === 'elsewhere') await markMissingPersonFound(closing.reportId, null, closingText)
      else await withdrawMissingPersonReport(closing.reportId, closingText)
      setNotice(closing.mode === 'elsewhere' ? 'Report closed as found.' : 'Report withdrawn. Its history is retained.')
      setClosing(null); setClosingText(''); await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to close the report.') }
    finally { setBusy(false) }
  }

  function exportCsv() {
    if (!result) return
    const blob = new Blob([reconciliationCsv(result, barangayName)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `rescue-reconciliation-${new Date().toISOString().slice(0, 10)}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  // ---------------------------------------------------------------- one list, grouped by next step
  const needle = query.trim().toLowerCase()
  const hit = (...parts: (string | null | undefined)[]) => !needle || parts.some((p) => p && p.toLowerCase().includes(needle))
  const items: Item[] = result ? [
    ...result.open.map((o): Item => ({ kind: 'report', key: `r:${o.report.report_id}`, o, group: o.classification === 'no-match' ? 'missing' : 'maybe', at: o.report.reported_at })),
    ...result.unaccounted.map((r): Item => ({ kind: 'resident', key: `u:${r.uid}`, r, group: 'unaccounted', at: r.latest_logged_at })),
    ...result.rescued.map((r): Item => ({ kind: 'resident', key: `s:${r.uid}`, r, group: 'safe', at: r.evacuated_at ?? r.latest_logged_at })),
    ...result.closed.map((c): Item => ({ kind: 'closed', key: `c:${c.report_id}`, c, group: 'closed', at: c.reconciled_at })),
  ] : []
  const counts: Record<Group, number> = { maybe: 0, missing: 0, unaccounted: 0, safe: 0, closed: 0 }
  items.forEach((i) => { counts[i.group] += 1 })
  const matches = (i: Item) => i.kind === 'report' ? hit(i.o.report.full_name, i.o.report.last_seen_location, barangayName(i.o.report.barangay_id))
    : i.kind === 'resident' ? hit(fullName(i.r), i.r.center_name, barangayName(i.r.barangay_id))
    : hit(i.c.full_name)
  // The rescued list is long: it shows when searching or when its counter is chosen.
  const visible = (g: Group) => (groupFilter ? groupFilter === g : g !== 'safe' || !!needle)
  const groups = GROUPS.map((g) => ({ ...g, list: visible(g.key) ? items.filter((i) => i.group === g.key && matches(i))
    .sort((a, b) => g.key === 'closed' || g.key === 'safe' ? Date.parse(b.at ?? '') - Date.parse(a.at ?? '') : Date.parse(a.at ?? '') - Date.parse(b.at ?? '')) : [] }))
  const shownCount = groups.reduce((n, g) => n + g.list.length, 0)
  const firstOpen = groups.filter((g) => g.key !== 'closed').flatMap((g) => g.list)[0]
  const selected = items.find((i) => i.key === sel) ?? firstOpen
  const showClosed = closedOpen || groupFilter === 'closed' || !!needle

  function pick(key: string) {
    setSel(key); setClosing(null); setOtherMatches(false)
    if (window.innerWidth < 1000) setTimeout(() => document.getElementById('missing-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
  }
  function openForm(seed: Partial<typeof emptyForm> = {}) {
    setForm({ ...emptyForm, barangay: form.barangay, ...seed }); setShowForm(true); setNotice('')
  }
  async function sendSearchTeam(o: ReconciledReport) {
    const r = o.report
    const activeEvent = data?.events.find((e) => e.event_id === r.event_id && e.status === 'active')
    setBusy(true); setError(''); setNotice('')
    try {
      await createDispatchTicket({ barangayId: r.barangay_id, eventId: activeEvent ? r.event_id : null, residentUid: r.resident_uid,
        subject: `Search for missing person: ${r.full_name}`, source: 'missing_report', sourceRef: r.report_id, priority: 'high',
        latitude: null, longitude: null, locationNote: r.last_seen_location ? `Last seen: ${r.last_seen_location}` : '',
        instructions: [r.notes, r.reporter_name ? `Reported by ${r.reporter_name}${r.reporter_contact ? ` (${r.reporter_contact})` : ''}` : ''].filter(Boolean).join('\n'),
        equipment: [], unitId: null })
      setNotice(`Search request made for ${r.full_name}. Assign a team on the Rescue requests tab.`)
      await loadSearches([r.report_id])
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not make the search request.') }
    finally { setBusy(false) }
  }

  function renderRow(i: Item) {
    const isSel = selected?.key === i.key
    let title: string, sub: string, pill: ReactNode, tone = 'normal'
    if (i.kind === 'report') {
      const r = i.o.report
      title = r.full_name
      sub = [barangayName(r.barangay_id), r.sex, r.approx_age !== null ? `~${r.approx_age}` : null, r.last_seen_location ? `last seen ${r.last_seen_location}` : null].filter(Boolean).join(' · ')
      tone = i.group === 'missing' ? 'critical' : 'high'
      pill = <span className={`op-pill ${i.group === 'missing' ? 'pill-sos' : 'pill-wait'}`}>{i.group === 'missing' ? 'No match yet' : matchLabels[i.o.classification]}</span>
    } else if (i.kind === 'resident') {
      title = fullName(i.r)
      if (i.group === 'safe') {
        sub = `Safe at ${i.r.center_name ?? 'an evacuation center'} · ${barangayName(i.r.barangay_id)}`
        pill = <span className="op-pill pill-safe">Safe</span>
      } else {
        sub = `${barangayName(i.r.barangay_id)} · ${i.r.latest_status ? statusLabels[i.r.latest_status] : 'No evacuation record'}`
        pill = <span className="op-pill pill-grey">Unaccounted</span>
      }
    } else {
      title = i.c.full_name
      sub = i.c.reconciliation_note ?? ''
      pill = <span className={`op-pill ${i.c.status === 'found' ? 'pill-safe' : 'pill-grey'}`}>{i.c.status === 'found' ? 'Found' : 'Withdrawn'}</span>
    }
    return <li key={i.key}>
      <button type="button" className={`op-row prio-${tone}${isSel ? ' is-selected' : ''}${i.group === 'closed' ? ' is-closed' : ''}`}
        aria-current={isSel ? 'true' : undefined} onClick={() => pick(i.key)}>
        <span className="op-row-main"><strong>{title}</strong><span className="op-row-sub">{sub}</span></span>
        <span className="op-row-side">{pill}<span className="op-row-age">{i.at ? elapsed(i.at) : ''}</span></span>
      </button>
    </li>
  }

  function closeForm(o: ReconciledReport) {
    return closing?.reportId === o.report.report_id && <form onSubmit={finishClosing} className="ticket-action-form">
      <h4>{closing.mode === 'elsewhere' ? 'Found elsewhere' : 'Withdraw this report'}</h4>
      <label>{closing.mode === 'elsewhere' ? 'Where / how was the person found?' : 'Reason (duplicate, false report…)'}
        <textarea required autoFocus maxLength={1000} value={closingText} onChange={(e) => setClosingText(e.target.value)} /></label>
      <div className="ticket-actions">
        <button className="verify-button" disabled={busy || !closingText.trim()}>{closing.mode === 'elsewhere' ? 'Close as found' : 'Withdraw report'}</button>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => setClosing(null)}>Back</button>
      </div>
    </form>
  }

  function renderReport(o: ReconciledReport) {
    const r = o.report
    const cands: MatchCandidate[] = o.candidates.length ? o.candidates
      : o.classification === 'linked-rescued' && o.linkedResident ? [{ resident: o.linkedResident, score: 100, reasons: ['The registered resident named in the report'] }] : []
    const best = cands[0]
    const search = searches.get(r.report_id)
    const eventName = r.event_id ? data?.events.find((e) => e.event_id === r.event_id)?.name : null
    return <>
      <div className="op-detail-head">
        <h3>{r.full_name} <span className={`reconcile-badge ${o.classification}`}>{o.classification === 'no-match' ? 'Still missing' : matchLabels[o.classification]}</span></h3>
        <p className="dispatch-muted">Reported {elapsed(r.reported_at)} ago by {r.reporter_name}{r.reporter_contact && ` · ${r.reporter_contact}`}</p>
      </div>
      <dl className="op-facts">
        <dt>Last seen</dt><dd>{r.last_seen_location || 'Not given'}{r.last_seen_at && ` · ${formatTime(r.last_seen_at)}`}</dd>
        <dt>About them</dt><dd>{[barangayName(r.barangay_id), r.sex ?? 'sex unknown', r.approx_age !== null ? `about ${r.approx_age}` : 'age unknown'].join(' · ')}</dd>
        {eventName && <><dt>Disaster</dt><dd>{eventName}</dd></>}
        {r.notes && <><dt>Notes</dt><dd>{r.notes}</dd></>}
        {o.linkedResident && o.classification !== 'linked-rescued' && <><dt>Registered as</dt><dd>{fullName(o.linkedResident)} · {o.linkedResident.latest_status ? statusLabels[o.linkedResident.latest_status] : 'no evacuation record'}</dd></>}
        {search && <><dt>Search team</dt><dd>Request D-{String(search.ticket_no).padStart(4, '0')} · {STATUS_LABELS[search.status]}</dd></>}
      </dl>
      {closeForm(o) || <>
        {best && <div>
          <p className="op-subhead">Best match in the rescued list</p>
          <dl className="op-facts">
            <dt>Name</dt><dd>{fullName(best.resident)}</dd>
            <dt>Where now</dt><dd>{best.resident.center_name ?? 'An evacuation center'} · since {formatTime(best.resident.evacuated_at ?? best.resident.latest_logged_at)}</dd>
            <dt>Why it matches</dt><dd>{best.reasons.join(' · ')} (score {best.score})</dd>
          </dl>
        </div>}
        {best
          ? <button type="button" className="op-next" disabled={busy} onClick={() => { void confirmMatch(o, best.resident.uid) }}>Yes, it's {fullName(best.resident)}: close as found</button>
          : search
            ? <p className="op-next-note">A search request is open. Follow it on the Rescue requests tab.</p>
            : <button type="button" className="op-next" disabled={busy} onClick={() => { void sendSearchTeam(o) }}>Send a search team</button>}
        {otherMatches && cands.slice(1).map((c) => <div key={c.resident.uid} className="missing-other">
          <span><strong>{fullName(c.resident)}</strong> · {c.resident.center_name ?? '—'} · {c.reasons.join(' · ')} (score {c.score})</span>
          <button type="button" className="secondary-button" disabled={busy} onClick={() => { void confirmMatch(o, c.resident.uid) }}>This is them</button>
        </div>)}
        <div className="op-small">
          {cands.length > 1 && !otherMatches && <button type="button" className="secondary-button" onClick={() => setOtherMatches(true)}>Other matches ({cands.length - 1})</button>}
          {best && !search && <button type="button" className="secondary-button" disabled={busy} onClick={() => { void sendSearchTeam(o) }}>Not them, send a search team</button>}
          {search && onOpenRequests && <button type="button" className="secondary-button" onClick={onOpenRequests}>Open Rescue requests</button>}
          <button type="button" className="secondary-button" disabled={busy} onClick={() => { setClosing({ reportId: r.report_id, mode: 'elsewhere' }); setClosingText('') }}>Found elsewhere…</button>
          <button type="button" className="danger-button" disabled={busy} onClick={() => { setClosing({ reportId: r.report_id, mode: 'withdraw' }); setClosingText('') }}>Withdraw report</button>
        </div>
      </>}
    </>
  }

  function renderResident(r: RegistryResident, safe: boolean) {
    return <>
      <div className="op-detail-head">
        <h3>{fullName(r)} <span className={`op-pill ${safe ? 'pill-safe' : 'pill-grey'}`}>{safe ? 'Safe' : 'Unaccounted'}</span></h3>
        <p className="dispatch-muted">{barangayName(r.barangay_id)}{r.sex ? ` · ${r.sex}` : ''}{ageOn(r.birthdate, new Date()) !== null ? ` · ${ageOn(r.birthdate, new Date())} years old` : ''}</p>
      </div>
      <dl className="op-facts">
        {safe
          ? <><dt>Where now</dt><dd>{r.center_name ?? 'An evacuation center'}</dd><dt>Since</dt><dd>{formatTime(r.evacuated_at ?? r.latest_logged_at)}</dd></>
          : <><dt>Evacuation status</dt><dd>{r.latest_status ? statusLabels[r.latest_status] : 'No evacuation record'}</dd>
            {r.latest_logged_at && <><dt>Last logged</dt><dd>{formatTime(r.latest_logged_at)}</dd></>}</>}
      </dl>
      {safe
        ? <p className="dispatch-muted">A relative asking about this person can be told they are safe at {r.center_name ?? 'an evacuation center'}.</p>
        : <>
          <p className="dispatch-muted">Their barangay has an active disaster, they are not in the rescued list, and no one has reported them missing yet.</p>
          <button type="button" className="op-next" disabled={!data} onClick={() => { pick(`u:${r.uid}`); openForm({ barangay: String(r.barangay_id), resident: r.uid, name: fullName(r),
            sex: r.sex === 'male' || r.sex === 'female' ? r.sex : '', age: String(ageOn(r.birthdate, new Date()) ?? '') }) }}>File a missing report</button>
        </>}
    </>
  }

  function renderClosed(c: MissingPersonReport) {
    const matched = c.matched_resident_uid ? data?.residents.find((x) => x.uid === c.matched_resident_uid) : null
    return <>
      <div className="op-detail-head">
        <h3>{c.full_name} <span className={`reconcile-badge ${c.status}`}>{c.status === 'found' ? 'Found' : 'Withdrawn'}</span></h3>
        <p className="dispatch-muted">Closed {formatTime(c.reconciled_at)}</p>
      </div>
      <dl className="op-facts">
        {matched && <><dt>Matched with</dt><dd>{fullName(matched)} · {matched.center_name ?? '—'}</dd></>}
        {c.reconciliation_note && <><dt>Note</dt><dd>{c.reconciliation_note}</dd></>}
        <dt>Reported by</dt><dd>{c.reporter_name} · {formatTime(c.reported_at)}</dd>
      </dl>
    </>
  }

  return <div className="dispatch-page reconcile-page">
    <section className="panel dispatch-top">
      <div className="dispatch-head">
        <div><h3>Missing persons</h3>
          <p className="dispatch-muted">Reports are checked against the rescued list (people safely evacuated). Matches are suggestions: you confirm each one.</p></div>
        <div className="ticket-actions">
          <button type="button" className="primary-button" disabled={!data} onClick={() => openForm()}>+ File a report</button>
          <button type="button" className="secondary-button" disabled={!result} onClick={exportCsv}>Download CSV</button>
        </div>
      </div>
      <div className="op-toolbar">
        <input type="search" className="op-search" placeholder="Is this person safe? Type a name…" aria-label="Search people by name" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {result && <div className="op-counters" role="group" aria-label="Show only">
        {GROUPS.map((g) => <button key={g.key} type="button" className={`op-counter${groupFilter === g.key ? ' is-on' : ''}`}
          aria-pressed={groupFilter === g.key} onClick={() => setGroupFilter((f) => (f === g.key ? null : g.key))}>
          <strong className={(g.key === 'missing' || g.key === 'unaccounted') && counts[g.key] ? 'bad' : g.key === 'maybe' && counts.maybe ? 'warn' : ''}>{counts[g.key]}</strong>
          <span>{g.counter}</span></button>)}
      </div>}
      {error && <p role="alert" className="dispatch-error">{error}</p>}
      {notice && <p role="status" className="dispatch-notice">{notice}</p>}
      {loading && <p role="status">Loading…</p>}
    </section>

    {result && <div className="op-split">
      <section className="panel op-list" aria-label="People">
        {needle && !shownCount && <div className="op-empty">
          <p>No one named "{query.trim()}" is in the rescued list or the reports.</p>
          <button type="button" className="primary-button" onClick={() => openForm({ name: query.trim() })}>File a report for "{query.trim()}"</button>
        </div>}
        {groups.map((g) => {
          if (g.key === 'closed') return g.list.length || !needle ? <div key={g.key}>
            <button type="button" className="op-group op-group-toggle" aria-expanded={showClosed} onClick={() => setClosedOpen((o) => !o)}>
              {g.title} ({g.list.length}) {showClosed ? '▾' : '▸'}</button>
            {showClosed && <ul>{g.list.map(renderRow)}</ul>}
          </div> : null
          if (!g.list.length && groupFilter !== g.key) return null
          return <div key={g.key}>
            <h4 className="op-group">{g.title} ({g.list.length})</h4>
            {g.list.length ? <ul>{g.list.map(renderRow)}</ul> : <p className="dispatch-muted op-empty">Nothing here right now.</p>}
          </div>
        })}
        {!needle && !items.length && <p className="dispatch-muted op-empty">No missing-person reports right now.</p>}
      </section>
      <section id="missing-detail" className="panel op-detail" aria-live="polite">
        {selected?.kind === 'report' ? renderReport(selected.o)
          : selected?.kind === 'resident' ? renderResident(selected.r, selected.group === 'safe')
          : selected?.kind === 'closed' ? renderClosed(selected.c)
          : <p className="dispatch-muted op-empty">Pick a person on the left to see the details.</p>}
      </section>
    </div>}
    {data && <p className="dispatch-muted">Snapshot: {formatTime(data.generated_at)} (Philippine time)</p>}

    {showForm && <SidePanel title="File a missing-person report" busy={busy} error={error} onClose={() => setShowForm(false)}><section>
      <form onSubmit={submit}>
        <fieldset className="reconcile-form" disabled={!data || busy || loading || !data.barangays.length}>
          <label>Barangay<select value={formBarangay || ''} onChange={e => setForm(f => ({ ...f, barangay: e.target.value, resident: '', event: '' }))}>
            {data?.barangays.map(si => <option key={si.barangay_id} value={si.barangay_id}>{si.barangay_name}</option>)}</select></label>
          <label>Active disaster event (optional)<select value={form.event} onChange={set('event')}>
            <option value="">None</option>{barangayEvents.map(e => <option key={e.event_id} value={e.event_id}>{e.name}</option>)}</select></label>
          <label className="reconcile-wide">Registered resident (optional — fills the details below)
            <select value={form.resident} onChange={e => pickResident(e.target.value)}>
              <option value="">Not registered / unknown</option>
              {barangayResidents.map(r => <option key={r.uid} value={r.uid}>{fullName(r)}{r.latest_status ? ` — ${statusLabels[r.latest_status]}` : ''}</option>)}
            </select></label>
          <label>Full name<input required maxLength={200} value={form.name} onChange={set('name')} /></label>
          <label>Sex<select value={form.sex} onChange={set('sex')}><option value="">Unknown</option><option value="male">Male</option><option value="female">Female</option></select></label>
          <label>Approximate age<input type="number" min={0} max={130} step={1} value={form.age} onChange={set('age')} /></label>
          <label>Last seen (Philippine time, optional)<input type="datetime-local" value={form.when} onChange={set('when')} /></label>
          <label className="reconcile-wide">Last-seen location<input maxLength={500} value={form.where} onChange={set('where')} /></label>
          <label>Reported by<input required maxLength={200} value={form.reporter} onChange={set('reporter')} /></label>
          <label>Reporter contact<input maxLength={50} value={form.contact} onChange={set('contact')} /></label>
          <label className="reconcile-wide">Description / notes<textarea rows={3} maxLength={2000} value={form.notes} onChange={set('notes')} /></label>
          <button className="primary-button" type="submit">{busy ? 'Saving…' : 'Add report'}</button>
        </fieldset>
      </form>
    </section></SidePanel>}
  </div>
}
