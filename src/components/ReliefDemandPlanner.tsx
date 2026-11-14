import { useState } from 'react'
import type { EvacuationCenter } from '../types/dashboard'
import { calculateReliefDemand, reliefCsvCell, validateReliefPopulation, validateReliefRates, type ReliefRates } from '../utils/reliefDemand'
import { RELIEF_REPORT_KEY, type ReliefReportDraft } from '../utils/reliefReportDraft'

// Relief supplies (Appendix N 2.3): how much food, water and hygiene kits each
// open evacuation center needs for one day, minus what it already has.
// The arithmetic lives in utils/reliefDemand.ts; this file is only the screen.

type Draft = { people: string; households: string; ffps: string; waterLiters: string; hygieneKits: string }
const emptyDraft: Draft = { people: '', households: '', ffps: '0', waterLiters: '0', hygieneKits: '0' }
const count = (value: string) => value.trim() === '' ? NaN : Number(value)
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const num = (value: number) => value.toLocaleString('en-PH')

// Sample amounts for trying the screen out. Water uses the Sphere minimum of
// 15 L per person per day; the others are placeholders, not official rates.
const SAMPLE_RATES = { ffpPerHousehold: '1', waterPerPerson: '15', kitsPerHousehold: '0.2' }

// The calculator's messages talk about "households"; on screen we say "families".
function plainError(message: string) {
  if (/stock/i.test(message)) return 'Supplies already at the center must be whole numbers, 0 or more.'
  if (/household|people/i.test(message)) return 'Enter how many people and families are here. An occupied center needs at least 1 family, and families cannot be more than people.'
  return message
}

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
    people: sum.people + row.people,
    households: sum.households + row.households,
    ffps: sum.ffps + row.demand!.request.ffps,
    waterLiters: sum.waterLiters + row.demand!.request.waterLiters,
    hygieneKits: sum.hygieneKits + row.demand!.request.hygieneKits,
  }), { people: 0, households: 0, ffps: 0, waterLiters: 0, hygieneKits: 0 })
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
    const url = URL.createObjectURL(new Blob(['﻿' + csvRows.map((row) => row.map(reliefCsvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url; link.download = `prioritycare-relief-draft-${date}.csv`
    document.body.appendChild(link); link.click(); link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    setMessage('Downloaded. Open the file in Excel. Nothing was ordered and no stock was changed.')
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
    try { sessionStorage.setItem(RELIEF_REPORT_KEY, JSON.stringify(draft)); setMessage('Saved. Go to Reports in this same browser tab and prepare the DROMIC report to include these numbers.') }
    catch { setMessage('This browser could not save the numbers for Reports. You can still download them.') }
  }
  return <section className="relief-planner">
    <div className="section-header"><div><h3>Relief supplies for one day</h3></div></div>
    <p>Work out how many food packs, liters of drinking water and hygiene kits each evacuation center needs today, minus what it already has. This is an estimate only: nothing is ordered and no stock changes.</p>

    <div className="relief-step">
      <h4>Step 1 · Date and daily amounts</h4>
      <p className="relief-hint">How much does each person or family get per day? Use the amounts your MSWDO approved. Put 0 for anything you are not giving out that day.</p>
      <div className="edit-form-grid">
        <label><span>Date</span><input required type="date" value={date} onChange={(e) => { setDate(e.target.value); setMessage('') }} /></label>
        <label><span>Food packs (FFPs) per family, per day</span><input type="number" min={0} max={10000} step={0.001} placeholder="e.g. 1" value={rateInputs.ffpPerHousehold} onChange={(e) => setRateInputs({ ...rateInputs, ffpPerHousehold: e.target.value })} /></label>
        <label><span>Drinking water per person, per day (liters)</span><input type="number" min={0} max={10000} step={0.001} placeholder="e.g. 15" value={rateInputs.waterPerPerson} onChange={(e) => setRateInputs({ ...rateInputs, waterPerPerson: e.target.value })} /></label>
        <label><span>Hygiene kits per family, per day</span><input type="number" min={0} max={10000} step={0.001} placeholder="e.g. 0.2 (1 kit every 5 days)" value={rateInputs.kitsPerHousehold} onChange={(e) => setRateInputs({ ...rateInputs, kitsPerHousehold: e.target.value })} /></label>
      </div>
      <div className="relief-actions">
        <button type="button" className="secondary-button" onClick={() => { setRateInputs(SAMPLE_RATES); setMessage('') }}>Fill in sample amounts</button>
        <span className="relief-hint">Sample: 1 food pack per family, 15 L water per person (Sphere minimum), 1 hygiene kit per family every 5 days.</span>
      </div>
      {rateError && <p className="vpi-missing">Fill in all three amounts to see results.</p>}
    </div>

    <div className="relief-step">
      <h4>Step 2 · Check each evacuation center</h4>
      <p className="relief-hint">People and families come from shelter check-ins. Change them only if the count is wrong. Enter supplies already at the center so they are subtracted. If a warehouse serves several centers, count its stock at one center only.</p>
      {rows.length === 0 && <p>No open evacuation centers. Closed centers are left out.</p>}
      {rows.map((row) => <details className="relief-facility" key={row.key} open={!(row.demand && row.people === 0)}>
        <summary><strong>{row.center.name}</strong> · {excluded[row.key]
          ? 'Left out'
          : row.demand && row.people === 0
            ? 'No evacuees yet'
            : row.demand
            ? `Needs ${num(row.demand.request.ffps)} food packs, ${num(row.demand.request.waterLiters)} L water, ${num(row.demand.request.hygieneKits)} hygiene kits`
            : rateError ? 'Waiting for Step 1' : 'Missing information'}</summary>
        <label className="resident-check"><input type="checkbox" checked={!excluded[row.key]} onChange={(e) => setExcluded({ ...excluded, [row.key]: !e.target.checked })} /><span>Include this center</span></label>
        {!excluded[row.key] && <>
          <fieldset className="relief-fieldset">
            <legend>Evacuees here</legend>
            <div className="edit-form-grid">
              <label><span>People {row.manualPeople ? '(typed in)' : row.center.occupancyKnown ? '(from check-ins)' : '(type in)'}</span><input type="number" min={0} max={1_000_000} step={1} value={row.draft.people} placeholder={row.center.occupancyKnown ? String(row.center.occupied) : 'Required'} onChange={(e) => field(row.key, 'people', e.target.value)} /></label>
              <label><span>Families</span><input type="number" min={0} max={1_000_000} step={1} value={row.draft.households} placeholder={Number.isFinite(row.households) ? String(row.households) : 'Required'} onChange={(e) => field(row.key, 'households', e.target.value)} /></label>
            </div>
          </fieldset>
          <fieldset className="relief-fieldset">
            <legend>Already at this center</legend>
            <div className="edit-form-grid">
              <label><span>Food packs</span><input type="number" min={0} step={1} value={row.draft.ffps} onChange={(e) => field(row.key, 'ffps', e.target.value)} /></label>
              <label><span>Drinking water (liters)</span><input type="number" min={0} step={1} value={row.draft.waterLiters} onChange={(e) => field(row.key, 'waterLiters', e.target.value)} /></label>
              <label><span>Hygiene kits</span><input type="number" min={0} step={1} value={row.draft.hygieneKits} onChange={(e) => field(row.key, 'hygieneKits', e.target.value)} /></label>
            </div>
          </fieldset>
          {!rateError && row.error && <p className="vpi-missing">{plainError(row.error)}</p>}
          {row.demand && <div className="relief-table-wrap"><table className="relief-table"><thead><tr><th>Item</th><th>Needed today</th><th>Already have</th><th>To request</th></tr></thead><tbody>
            <tr><th>Food packs</th><td>{num(row.demand.gross.ffps)}</td><td>− {num(row.stock.ffps)}</td><td><strong>{num(row.demand.request.ffps)}</strong></td></tr>
            <tr><th>Water (L)</th><td>{num(row.demand.gross.waterLiters)}</td><td>− {num(row.stock.waterLiters)}</td><td><strong>{num(row.demand.request.waterLiters)}</strong></td></tr>
            <tr><th>Hygiene kits</th><td>{num(row.demand.gross.hygieneKits)}</td><td>− {num(row.stock.hygieneKits)}</td><td><strong>{num(row.demand.request.hygieneKits)}</strong></td></tr>
          </tbody></table></div>}
        </>}
      </details>)}
    </div>

    <div className="relief-step">
      <h4>Step 3 · Total to request</h4>
      {pending > 0 && <p className="vpi-missing">{pending} {pending === 1 ? 'center still needs' : 'centers still need'} information in Step 2. The total below leaves {pending === 1 ? 'it' : 'them'} out until fixed.</p>}
      {valid.length > 0 && <div className="relief-table-wrap"><table className="relief-table"><thead><tr><th>Center</th><th>People</th><th>Families</th><th>Food packs</th><th>Water (L)</th><th>Hygiene kits</th></tr></thead><tbody>
        {valid.map((row) => <tr key={row.key}><th>{row.center.name}</th><td>{num(row.people)}</td><td>{num(row.households)}</td><td>{num(row.demand!.request.ffps)}</td><td>{num(row.demand!.request.waterLiters)}</td><td>{num(row.demand!.request.hygieneKits)}</td></tr>)}
        <tr className="relief-total-row"><th>Total</th><td>{num(totals.people)}</td><td>{num(totals.households)}</td><td>{num(totals.ffps)}</td><td>{num(totals.waterLiters)}</td><td>{num(totals.hygieneKits)}</td></tr>
      </tbody></table></div>}
      <div className="relief-actions">
        <button type="button" className="verify-button" disabled={!canExport} onClick={exportDraft}>Download for Excel (CSV)</button>
        <button type="button" className="secondary-button" disabled={!canExport} onClick={saveForReports}>Use in DROMIC report</button>
      </div>
      {message && <p role="status">{message}</p>}
      <p className="relief-hint">Your entries clear when you leave this page, so download or save first. "Use in DROMIC report" keeps the numbers in this browser tab only.</p>
    </div>
  </section>
}
