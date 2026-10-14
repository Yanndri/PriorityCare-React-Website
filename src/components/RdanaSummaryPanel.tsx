import { useState } from 'react'
import { fetchRdanaData } from '../api/rdanaApi'
import { buildRdanaSummary } from '../utils/rdana'

export function RdanaSummaryPanel() {
  const [hours, setHours] = useState<24 | 48>(24)
  const [context, setContext] = useState('')
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [reviewed, setReviewed] = useState(false)
  const [partial, setPartial] = useState(false)
  const [fileStamp, setFileStamp] = useState('')
  async function generate() {
    if (loading) return
    setLoading(true); setError(''); setReviewed(false); setDraft(''); setPartial(false)
    try {
      const data = await fetchRdanaData(hours)
      setDraft(buildRdanaSummary(data, context))
      setFileStamp(`${data.window.hours}h-${data.window.end.replaceAll(':', '-').slice(0, 19)}`)
      setPartial([data.sos, data.loggedEvacuations, data.completedEvacuations, data.profiles, data.disabilityResidents, data.shelters].some((section) => !section.available))
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to generate the summary. Try again.') }
    finally { setLoading(false) }
  }
  function download() {
    if (!reviewed || !draft) return
    const url = URL.createObjectURL(new Blob([draft], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url; link.download = `prioritycare-rdana-DRAFT-${fileStamp}.txt`
    document.body.appendChild(link); link.click(); link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <section className="panel rdana-panel">
    <div className="section-header"><div><span className="panel-kicker">24–48 HOUR SITUATION REPORTING</span><h3>RDANA Situation Summary</h3></div><span>Prototype draft</span></div>
    <p>Generate a summary of recorded activity in your assigned sitio over the last 24 or 48 hours. The shelter section covers shared facilities across all sitios and shows current conditions, not historical occupancy.</p>
    <fieldset disabled={loading} className="resident-edit-fields">
      <div className="edit-form-grid"><label><span>Reporting window</span><select value={hours} onChange={(e) => { setHours(Number(e.target.value) as 24 | 48); setDraft(''); setReviewed(false) }}><option value={24}>Last 24 hours</option><option value={48}>Last 48 hours</option></select></label></div>
      <label className="resident-notes">Incident context / assessment notes (optional)<textarea maxLength={2000} value={context} onChange={(e) => { setContext(e.target.value); setDraft(''); setReviewed(false) }} placeholder="Event name, affected area, and verified assessment notes. Do not enter personal identifiers." /></label>
      <button type="button" className="verify-button" onClick={() => void generate()}>{loading ? 'Generating summary…' : 'Generate RDANA Draft'}</button>
    </fieldset>
    {loading && <p role="status">Reading timestamped records and current snapshots…</p>}
    {error && <p role="alert" className="dashboard-error">{error}</p>}
    {draft && <>
      {partial && <p role="alert" className="vpi-demo-notice">Some data sources could not be retrieved. Their sections are marked Not available. Review these gaps before distributing the draft.</p>}
      <label className="resident-notes">Generated summary — review and edit before export<textarea className="rdana-preview" value={draft} onChange={(e) => { setDraft(e.target.value); setReviewed(false) }} spellCheck /></label>
      <label className="resident-check"><input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} /><span>I reviewed the scope, timestamps, figures, and assessment gaps. This remains a prototype draft.</span></label>
      <button type="button" className="secondary-button" disabled={!reviewed || !draft.trim()} onClick={download}>Download Reviewed Draft (.txt)</button>
    </>}
    <p>No AI service is required. Generating and downloading this draft do not change records, submit a report, or establish compliance with an official RDANA template.</p>
  </section>
}
