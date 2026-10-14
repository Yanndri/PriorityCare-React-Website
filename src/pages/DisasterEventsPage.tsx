import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { declareEvent, getEventRegister, hazardLabels, resolveEvent } from '../api/disasterEventsApi'
import type { EventRegister, HazardType } from '../api/disasterEventsApi'
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
  const [sitio, setSitio] = useState('')
  const [location, setLocation] = useState('')
  const [onset, setOnset] = useState(manilaNow)
  const [notes, setNotes] = useState('')
  const [latitude, setLatitude] = useState('')
  const [longitude, setLongitude] = useState('')
  const [resolving, setResolving] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [filter, setFilter] = useState<'active' | 'resolved' | 'all'>('active')
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
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setNotice('')
    const startedAt = new Date(`${onset}:00+08:00`)
    if (!Number.isFinite(startedAt.getTime()) || startedAt.getTime() > Date.now()) {
      setError('Enter an onset time that is not in the future (Philippine time).'); return
    }
    if (Boolean(latitude.trim()) !== Boolean(longitude.trim())) {
      setError('Provide both coordinates, or leave both blank.'); return
    }
    const lat = latitude.trim() ? Number(latitude) : null
    const lng = longitude.trim() ? Number(longitude) : null
    if ((lat !== null && (!Number.isFinite(lat) || Math.abs(lat) > 90)) ||
        (lng !== null && (!Number.isFinite(lng) || Math.abs(lng) > 180))) {
      setError('Enter valid GPS coordinates.'); return
    }
    setBusy(true)
    try {
      await declareEvent({ sitio: Number(sitio || register?.sitios[0]?.sitio_id), name, hazard, location,
        startedAt: startedAt.toISOString(), notes, latitude: lat, longitude: lng })
      setName(''); setLocation(''); setNotes(''); setLatitude(''); setLongitude(''); setOnset(manilaNow())
      setNotice('Disaster event declared.'); setFilter('active'); await load()
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
  return <div className="disaster-events-page">
    <section className="panel disaster-intro">
      <h3>Disaster event register</h3>
      <p>Declare operational incidents for your assigned sitio. All times are Philippine time (UTC+8).</p>
      <p>Declarations do not send responder notifications or associate existing SOS alerts. A map point identifies a reference location, not a danger-zone boundary.</p>
      <strong>{register ? `${events.filter(e => e.status === 'active').length} active events in your scope` : 'Register unavailable'}</strong>
      <button type="button" className="secondary-button" disabled={loading || busy} onClick={() => { void load() }}>Refresh register</button>
    </section>
    {error && <p role="alert" className="disaster-error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {loading && <p role="status">Loading event register…</p>}
    <section className="panel">
      <h3>Declare an active event</h3>
      <form onSubmit={submit}>
        <fieldset disabled={!register || busy || loading || !register.sitios.length} className="disaster-form">
          <label>Event name<input required maxLength={120} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Riverside flood — October 14" /></label>
          <label>Hazard<select value={hazard} onChange={e => setHazard(e.target.value as HazardType)}>{Object.entries(hazardLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label>Sitio<select required value={sitio || register?.sitios[0]?.sitio_id || ''} onChange={e => setSitio(e.target.value)}>{register?.sitios.map(s => <option key={s.sitio_id} value={s.sitio_id}>{s.sitio_name}</option>)}</select></label>
          <label>Incident onset (Philippine time)<input required type="datetime-local" value={onset} onChange={e => setOnset(e.target.value)} /></label>
          <label className="disaster-wide">Affected location / landmark<input required maxLength={500} value={location} onChange={e => setLocation(e.target.value)} /></label>
          <label>Reference latitude (optional)<input type="number" step="any" min={-90} max={90} value={latitude} onChange={e => setLatitude(e.target.value)} /></label>
          <label>Reference longitude (optional)<input type="number" step="any" min={-180} max={180} value={longitude} onChange={e => setLongitude(e.target.value)} /></label>
          <label className="disaster-wide">Situation notes / source (optional)<textarea maxLength={2000} rows={3} value={notes} onChange={e => setNotes(e.target.value)} /></label>
          <button className="primary-button" type="submit">{busy ? 'Saving…' : 'Declare active event'}</button>
        </fieldset>
      </form>
    </section>
    <section className="panel">
      <div className="disaster-list-header"><h3>Event history</h3><label>Show <select value={filter} onChange={e => setFilter(e.target.value as typeof filter)}><option value="active">Active</option><option value="resolved">Resolved</option><option value="all">All</option></select></label></div>
      {register && !events.some(e => filter === 'all' || e.status === filter) && <p>No {filter === 'all' ? '' : filter} events in your scope.</p>}
      {events.filter(e => filter === 'all' || e.status === filter).map(event => <article key={event.event_id} className="disaster-event-card">
        <div className="disaster-list-header"><h4>{event.name}</h4><span className={`disaster-status ${event.status}`}>{hazardLabels[event.hazard_type]} · {event.status}</span></div>
        <p>{register?.sitios.find(s => s.sitio_id === event.sitio_id)?.sitio_name} · {event.location_description}</p>
        <p>Onset: {formatTime(event.started_at)} · Declared: {formatTime(event.declared_at)}</p>
        {event.latitude !== null && <p>Reference point: {event.latitude}, {event.longitude}</p>}
        {event.notes && <p className="disaster-notes">{event.notes}</p>}
        {event.status === 'resolved' && <p>Resolved: {formatTime(event.resolved_at!)} · {event.resolution_reason}</p>}
        {event.status === 'active' && resolving !== event.event_id && <button type="button" className="secondary-button" disabled={busy || loading} onClick={() => { setResolving(event.event_id); setReason('') }}>Resolve event</button>}
        {resolving === event.event_id && <form onSubmit={finish} className="disaster-resolution"><label>Resolution reason<textarea required maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></label><p>This ends the active declaration and keeps its history.</p><button className="primary-button" disabled={busy || loading || !reason.trim()}>Confirm resolution</button><button type="button" className="secondary-button" disabled={busy} onClick={() => setResolving(null)}>Cancel</button></form>}
      </article>)}
    </section>
  </div>
}
