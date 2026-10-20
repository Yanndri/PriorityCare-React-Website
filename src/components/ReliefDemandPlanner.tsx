import { useState } from 'react'
import type { EvacuationCenter } from '../types/dashboard'
import { calculateReliefDemand, reliefCsvCell, validateReliefPopulation, validateReliefRates, type ReliefRates } from '../utils/reliefDemand'
import { RELIEF_REPORT_KEY, type ReliefReportDraft } from '../utils/reliefReportDraft'

type Draft = { people: string; households: string; ffps: string; waterLiters: string; hygieneKits: string }
const emptyDraft: Draft = { people: '', households: '', ffps: '0', waterLiters: '0', hygieneKits: '0' }
const count = (value: string) => value.trim() === '' ? NaN : Number(value)
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

export function ReliefDemandPlanner({ centers }: { centers: EvacuationCenter[] }) {
  const [date, setDate] = useState(today)
  const [rateInputs, setRateInputs] = useState({ ffpPerHousehold: '', waterPerPerson: '', kitsPerHousehold: '' })
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [excluded, setExcluded] = useState<Record<string, boolean>>({})
  const [message, setMessage] = useState('')
  const rates: ReliefRates = { ffpPerHousehold: count(rateInputs.ffpPerHousehold), waterPerPerson: count(rateInputs.waterPerPerson), kitsPerHousehold: count(rateInputs.kitsPerHousehold) }
  const rateError = validateReliefRates(rates)
  const rows = centers.filter((center) => center.status.toLowerCase() !== 'closed').map((center) => {
    const key = String(center.id ?? center.name)
    const draft = drafts[key] ?? emptyDraft
    const manualPeople = draft.people.trim() !== ''
    const people = manualPeople ? count(draft.people) : center.occupancyKnown ? center.occupied : NaN
    // Households come from check-ins too, unless the planner typed a population for another date.
    const recordedHouseholds = !manualPeople && center.households !== undefined ? center.households : NaN
    const households = draft.households.trim() !== '' ? count(draft.households) : people === 0 ? 0 : recordedHouseholds
    const stock = { ffps: count(draft.ffps), waterLiters: count(draft.waterLiters), hygieneKits: count(draft.hygieneKits) }
    let error = rateError || validateReliefPopulation({ people, households })
    let demand: ReturnType<typeof calculateReliefDemand> | null = null
    if (!error) {
      try { demand = calculateReliefDemand({ people, households }, rates, stock) }
      catch (reason) { error = reason instanceof Error ? reason.message : 'Invalid planning inputs.' }
    }
    return { center, key, draft, people, households, stock, error, demand, manualPeople }
  })
  const included = rows.filter((row) => !excluded[row.key])
  const pending = included.filter((row) => !row.demand).length
  const valid = included.filter((row) => row.demand)
  const totals = valid.reduce((sum, row) => ({
    ffps: sum.ffps + row.demand!.request.ffps,
    waterLiters: sum.waterLiters + row.demand!.request.waterLiters,
    hygieneKits: sum.hygieneKits + row.demand!.request.hygieneKits,
  }), { ffps: 0, waterLiters: 0, hygieneKits: 0 })
  const canExport = Boolean(date) && included.length > 0 && pending === 0
  function field(key: string, name: keyof Draft, value: string) {
    setDrafts((current) => ({ ...current, [key]: { ...(current[key] ?? emptyDraft), [name]: value } }))
    setMessage('')
  }
  function exportDraft() {
    if (!canExport) return
    const generated = new Date().toISOString()
    const csvRows: (string | number)[][] = [
      ['Daily relief requisition DRAFT — prototype'], ['Planning date', date], ['Generated at (UTC)', generated],
      ['FFPs per household/day', rates.ffpPerHousehold], ['Water liters per person/day', rates.waterPerPerson], ['Hygiene kits per household/day', rates.kitsPerHousehold],
      ['Method', 'Rounded up to whole units/liters per facility; request = max(gross demand - assigned usable stock, 0).'],
      ['Facility ID', 'Facility', 'People', 'Households', 'Population source', 'Gross FFPs', 'Gross water liters', 'Gross hygiene kits', 'Stock FFPs', 'Stock water liters', 'Stock hygiene kits', 'Request FFPs', 'Request water liters', 'Request hygiene kits'],
      ...included.map((row) => [row.center.id ?? '', row.center.name, row.people, row.households,
        row.manualPeople ? 'Manually entered for planning date' : 'Current recorded occupancy (not historical)',
        row.demand!.gross.ffps, row.demand!.gross.waterLiters, row.demand!.gross.hygieneKits,
        row.stock.ffps, row.stock.waterLiters, row.stock.hygieneKits,
        row.demand!.request.ffps, row.demand!.request.waterLiters, row.demand!.request.hygieneKits]),
      ['TOTAL REQUEST', '', '', '', '', '', '', '', '', '', '', totals.ffps, totals.waterLiters, totals.hygieneKits],
      ['Excluded facilities', rows.filter((row) => excluded[row.key]).map((row) => row.center.name).join('; ')],
    ]
    const url = URL.createObjectURL(new Blob(['\uFEFF' + csvRows.map((row) => row.map(reliefCsvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url; link.download = `prioritycare-relief-draft-${date}.csv`
    document.body.appendChild(link); link.click(); link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    setMessage('Draft exported. No stock was deducted and no requisition was submitted.')
  }
  function saveForReports() {
    if (!canExport) return
    const draft: ReliefReportDraft = {
      date, savedAt: new Date().toISOString(), scope: 'Selected shared facilities; manual counts and rates', rates,
      rows: included.map((row) => ({ centerId: String(row.center.id ?? row.center.name), centerName: row.center.name,
        people: row.people, households: row.households, stock: row.stock,
        source: row.manualPeople ? 'Manual planning population' : 'Current recorded occupancy' })),
      excludedCenters: rows.filter((row) => excluded[row.key]).map((row) => row.center.name),
    }
    try { sessionStorage.setItem(RELIEF_REPORT_KEY, JSON.stringify(draft)); setMessage('Relief draft saved for Reports in this browser tab. It remains a planning estimate, not a distribution record.') }
    catch { setMessage('This browser could not save the draft for Reports. CSV export remains available.') }
  }
  return <section className="relief-planner">
    <div className="section-header"><div><span className="panel-kicker">DAILY RELIEF PLANNING · PROTOTYPE</span><h3>Relief requisition demand</h3></div></div>
    <p>Calculate Family Food Packs (FFPs), potable-water liters, and hygiene kits using your approved daily rates. A kit’s daily rate can be zero on days it is not distributed. This is a draft calculator; it does not submit orders or change inventory.</p>
    <div className="edit-form-grid">
      <label><span>Planning date</span><input required type="date" value={date} onChange={(e) => { setDate(e.target.value); setMessage('') }} /></label>
      <label><span>FFPs per household per day</span><input type="number" min={0} max={10000} step={0.001} value={rateInputs.ffpPerHousehold} onChange={(e) => setRateInputs({ ...rateInputs, ffpPerHousehold: e.target.value })} /></label>
      <label><span>Potable water liters per person per day</span><input type="number" min={0} max={10000} step={0.001} value={rateInputs.waterPerPerson} onChange={(e) => setRateInputs({ ...rateInputs, waterPerPerson: e.target.value })} /></label>
      <label><span>Hygiene kits per household per day</span><input type="number" min={0} max={10000} step={0.001} value={rateInputs.kitsPerHousehold} onChange={(e) => setRateInputs({ ...rateInputs, kitsPerHousehold: e.target.value })} /></label>
    </div>
    <p>People and households fill in from shelter check-ins (each walk-in group counts as one household). Type over them only to correct a count, or to plan for another date.</p>
    {rateError && <p className="vpi-missing">Enter all three rates to calculate demand. No official rate is assumed.</p>}
    {rows.length === 0 && <p>No active facilities available. Closed centers are excluded from daily planning.</p>}
    {rows.map((row) => <details className="relief-facility" key={row.key} open>
      <summary><strong>{row.center.name}</strong> · {excluded[row.key] ? 'Excluded' : row.demand ? 'Calculated' : 'Needs input'}</summary>
      <label className="resident-check"><input type="checkbox" checked={!excluded[row.key]} onChange={(e) => setExcluded({ ...excluded, [row.key]: !e.target.checked })} /><span>Include in this day’s draft</span></label>
      {!excluded[row.key] && <>
        <div className="edit-form-grid">
          <label><span>People ({row.manualPeople ? 'manual' : row.center.occupancyKnown ? 'using current records' : 'enter manually'})</span><input type="number" min={0} max={1_000_000} step={1} value={row.draft.people} placeholder={row.center.occupancyKnown ? String(row.center.occupied) : 'Required'} onChange={(e) => field(row.key, 'people', e.target.value)} /></label>
          <label><span>Distinct evacuated households</span><input type="number" min={0} max={1_000_000} step={1} value={row.draft.households} placeholder={Number.isFinite(row.households) ? String(row.households) : 'Confirm at desk'} onChange={(e) => field(row.key, 'households', e.target.value)} /></label>
          <label><span>Usable FFP stock assigned to this center</span><input type="number" min={0} step={1} value={row.draft.ffps} onChange={(e) => field(row.key, 'ffps', e.target.value)} /></label>
          <label><span>Usable potable-water stock (whole liters)</span><input type="number" min={0} step={1} value={row.draft.waterLiters} onChange={(e) => field(row.key, 'waterLiters', e.target.value)} /></label>
          <label><span>Usable hygiene-kit stock</span><input type="number" min={0} step={1} value={row.draft.hygieneKits} onChange={(e) => field(row.key, 'hygieneKits', e.target.value)} /></label>
        </div>
        {!rateError && row.error && <p className="vpi-missing">{row.error}</p>}
        {row.demand && <div className="relief-table-wrap"><table className="relief-table"><thead><tr><th>Supply</th><th>Gross daily demand</th><th>Usable stock</th><th>Request</th></tr></thead><tbody>
          <tr><th>FFPs</th><td>{row.demand.gross.ffps}</td><td>{row.stock.ffps}</td><td>{row.demand.request.ffps}</td></tr>
          <tr><th>Water (L)</th><td>{row.demand.gross.waterLiters}</td><td>{row.stock.waterLiters}</td><td>{row.demand.request.waterLiters}</td></tr>
          <tr><th>Hygiene kits</th><td>{row.demand.gross.hygieneKits}</td><td>{row.stock.hygieneKits}</td><td>{row.demand.request.hygieneKits}</td></tr>
        </tbody></table></div>}
      </>}
    </details>)}
    <p>Assign warehouse stock to only one center’s row. Supplies and liters are rounded up per center before totals are added.</p>
    <p className="relief-total"><strong>{pending > 0 ? `Partial subtotal — ${pending} included facility/facilities still need input` : 'Total draft request'}:</strong> {totals.ffps} FFPs · {totals.waterLiters} L water · {totals.hygieneKits} hygiene kits</p>
    <button type="button" className="verify-button" disabled={!canExport} onClick={exportDraft}>Export Daily Requisition Draft (CSV)</button>
    <button type="button" className="secondary-button" disabled={!canExport} onClick={saveForReports}>Save Draft for Reports</button>
    {message && <p role="status">{message}</p>}
    <p>Inputs reset when you leave this page. Save Draft for Reports keeps an aggregate copy in this browser tab for export. Changing the date does not fetch historical occupancy.</p>
  </section>
}
