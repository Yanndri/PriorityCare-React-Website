import { useEffect, useState } from 'react'
import { useLiveSignal } from '../lib/useLiveSignal'
import type { FormEvent } from 'react'
import { declareEvent, getEventRegister, hazardLabels, resolveEvent } from '../api/disasterEventsApi'
import type { DisasterEvent, EventRegister, HazardType } from '../api/disasterEventsApi'
import { DisasterAreaPicker } from '../components/DisasterAreaPicker'
import './DisasterEventsPage.css'

function manilaNow() {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 16)
}
const formatTime = (value: string) => new Date(value).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })

export function DisasterEventsPage() {
  const [register, setRegister] = useState<EventRegister | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [name, setName] = useState('')
  const [hazard, setHazard] = useState<HazardType>('flood')
  const [barangay, setBarangay] = useState('')
  const [location, setLocation] = useState('')
  const [onset, setOnset] = useState(manilaNow)
  const [notes, setNotes] = useState('')
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null)
  const [resolving, setResolving] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [showForm, setShowForm] = useState(false)
  async function load() {
    setLoading(true); setError('')
    try { setRegister(await getEventRegister()) }
    catch (e) { setRegister(null); setError(e instanceof Error ? e.message : 'Unable to load events.') }
    finally { setLoading(false) }
  }
  useEffect(() => {
    let cancelled = false
    getEventRegister().then(data => { if (!cancelled) setRegister(data) })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Unable to load events.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])
  // Declarations made by another admin show up here too.
  useLiveSignal(['events'], () => {
    getEventRegister().then(setRegister).catch(() => { /* keep what is shown */ })
  })
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setNotice('')
    const startedAt = new Date(`${onset}:00+08:00`)
    if (!Number.isFinite(startedAt.getTime()) || startedAt.getTime() > Date.now()) {
      setError('Enter an onset time that is not in the future (Philippine time).'); return
    }
    setBusy(true)
    try {
      await declareEvent({ barangay: Number(barangay || register?.barangays[0]?.barangay_id), name, hazard, location,
        startedAt: startedAt.toISOString(), notes, latitude: pin?.lat ?? null, longitude: pin?.lng ?? null })
      setName(''); setLocation(''); setNotes(''); setPin(null); setOnset(manilaNow())
      setNotice('Disaster declared.'); setShowForm(false); await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Declaration failed.') }
    finally { setBusy(false) }
  }
  async function finish(event: FormEvent) {
    event.preventDefault()
    if (!resolving) return
    setBusy(true); setError(''); setNotice('')
    try {
      await resolveEvent(resolving, reason); setResolving(null); setReason('')
      setNotice('Event resolved. The declaration and audit history are retained.'); await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Resolution failed.') }
    finally { setBusy(false) }
  }
  const events = register?.events ?? []
  const active = events.filter(e => e.status === 'active')
  const past = events.filter(e => e.status !== 'active')
  const eventCard = (event: DisasterEvent) => <article key={event.event_id} className="disaster-event-card">
        <div className="disaster-list-header"><h4>{event.name}</h4><span className={`disaster-status ${event.status}`}>{hazardLabels[event.hazard_type]} · {event.status}</span></div>
        <p>{register?.barangays.find(s => s.barangay_id === event.barangay_id)?.barangay_name} · {event.location_description}</p>
        <p>Onset: {formatTime(event.started_at)} · Declared: {formatTime(event.declared_at)}</p>
        {event.latitude !== null && <p>Pin: {Number(event.latitude).toFixed(5)}, {Number(event.longitude).toFixed(5)}</p>}
        {event.notes && <p className="disaster-notes">{event.notes}</p>}
        {event.status === 'resolved' && <p>Resolved: {formatTime(event.resolved_at!)} · {event.resolution_reason}</p>}
        {event.status === 'active' && resolving !== event.event_id && <button type="button" className="secondary-button" disabled={busy || loading} onClick={() => { setResolving(event.event_id); setReason('') }}>Resolve event</button>}
        {resolving === event.event_id && <form onSubmit={finish} className="disaster-resolution"><label>Resolution reason<textarea required maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></label><p>This ends the active declaration and keeps its history.</p><button className="primary-button" disabled={busy || loading || !reason.trim()}>Confirm resolution</button><button type="button" className="secondary-button" disabled={busy} onClick={() => setResolving(null)}>Cancel</button></form>}
      </article>
  return <div className="disaster-events-page">
    {error && <p role="alert" className="disaster-error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {loading && <p role="status">Loading event register…</p>}
    <section className="panel">
      <div className="disaster-list-header">
        <h3>Active disasters ({active.length})</h3>
        {!showForm && <button type="button" className="primary-button" disabled={!register?.barangays.length || loading} onClick={() => { setShowForm(true); setNotice('') }}>Declare a new disaster</button>}
      </div>
      {register && !active.length && <p>No active disaster in your scope.</p>}
      {active.map(eventCard)}
    </section>
    {showForm && <section className="panel">
      <h3>Declare a new disaster</h3>
      <p className="disaster-hint">Residents of the barangay see it in the app. All times are Philippine time.</p>
      <form onSubmit={submit}>
        <fieldset disabled={!register || busy || loading || !register.barangays.length} className="disaster-form">
          <label>Event name<input required maxLength={120} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Riverside flood — October 14" /></label>
          <label>Hazard<select value={hazard} onChange={e => setHazard(e.target.value as HazardType)}>{Object.entries(hazardLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label>Barangay<select required value={barangay || register?.barangays[0]?.barangay_id || ''} onChange={e => setBarangay(e.target.value)}>{register?.barangays.map(s => <option key={s.barangay_id} value={s.barangay_id}>{s.barangay_name}</option>)}</select></label>
          <label>Incident onset (Philippine time)<input required type="datetime-local" value={onset} onChange={e => setOnset(e.target.value)} /></label>
          <label className="disaster-wide">Affected location / landmark<input required maxLength={500} value={location} onChange={e => setLocation(e.target.value)} /></label>
          <div className="disaster-wide">
            <p className="disaster-map-label">Location on the map (optional)</p>
            <DisasterAreaPicker barangayId={Number(barangay || register?.barangays[0]?.barangay_id) || null} latitude={pin?.lat ?? null} longitude={pin?.lng ?? null} disabled={!register || busy || loading}
              onChange={(lat, lng) => setPin(lat !== null && lng !== null ? { lat, lng } : null)} />
          </div>
          <label className="disaster-wide">Situation notes / source (optional)<textarea maxLength={2000} rows={3} value={notes} onChange={e => setNotes(e.target.value)} /></label>
          <div className="disaster-wide disaster-form-actions"><button className="primary-button" type="submit">{busy ? 'Saving…' : 'Declare disaster'}</button><button type="button" className="secondary-button" disabled={busy} onClick={() => setShowForm(false)}>Cancel</button></div>
        </fieldset>
      </form>
    </section>}
    <section className="panel">
      <h3>Past disasters ({past.length})</h3>
      {register && !past.length && <p>No resolved disasters yet.</p>}
      {past.map(eventCard)}
    </section>
  </div>
}
