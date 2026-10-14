import { useEffect, useState } from 'react'
import type { Resident } from '../types/dashboard'
import { calculateVpi, DEFAULT_VPI_RULES, validateVpiRules, vpiToday, type VpiRules } from '../utils/vpi'

const RULES_KEY = 'prioritycare.prototype-vpi.v1'
function initialRules(): VpiRules {
  try {
    const stored = JSON.parse(localStorage.getItem(RULES_KEY) ?? 'null') as Partial<VpiRules> | null
    const rules = { ...DEFAULT_VPI_RULES, ...stored }
    return validateVpiRules(rules) ? DEFAULT_VPI_RULES : rules
  } catch { return DEFAULT_VPI_RULES }
}
const ruleLabels: Record<keyof VpiRules, string> = {
  age: 'Under 5 or age 60+ points', semiAmbulatory: 'Semi-ambulatory points',
  nonAmbulatory: 'Non-ambulatory points', disability: 'Any recorded disability points',
  pregnancy: 'Pregnancy points', moderateAt: 'Moderate starts at', highAt: 'High starts at',
}

export function VpiPanel({ residents }: { residents: Resident[] }) {
  const [rules, setRules] = useState(initialRules)
  const [draft, setDraft] = useState(rules)
  const [asOf, setAsOf] = useState(vpiToday)
  const [error, setError] = useState('')
  useEffect(() => {
    const timer = window.setInterval(() => setAsOf(vpiToday()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  const scored = residents.map((resident) => ({ resident, vpi: calculateVpi(resident, rules, asOf) }))
    .sort((a, b) => Number(a.vpi.level === 'Incomplete') - Number(b.vpi.level === 'Incomplete')
      || b.vpi.score - a.vpi.score || a.resident.name.localeCompare(b.resident.name))
  const incomplete = scored.filter((item) => item.vpi.level === 'Incomplete').length
  const ruleError = validateVpiRules(draft)
  function apply(next: VpiRules) {
    setRules(next); setDraft(next); setError('')
    try { localStorage.setItem(RULES_KEY, JSON.stringify(next)) }
    catch { setError('Settings apply for this session, but could not be saved on this browser.') }
  }
  return <section className="panel prototype-vpi">
    <div className="section-header"><div><span className="panel-kicker">AUTOMATED VPI · PROTOTYPE</span><h3>Resident vulnerability scores</h3></div><span>{scored.length} profiles</span></div>
    <p className="vpi-demo-notice">Demonstration weights only. These scores do not determine dispatch, rescue order, or medical triage.</p>
    <p>Calculated {asOf} (Asia/Manila) · {incomplete} incomplete assessment(s). Scores update after profile changes and birthdays.</p>
    <details className="vpi-settings">
      <summary>Demo scoring rules & settings</summary>
      <p>Age points + maximum of mobility/disability points + pregnancy points. Verification, GPS presence, free-text medical notes, and household size add no points. Each resident account is scored individually.</p>
      <div className="edit-form-grid">{(Object.keys(ruleLabels) as (keyof VpiRules)[]).map((field) => <label key={field}><span>{ruleLabels[field]}</span><input type="number" min={0} max={30} step={1} value={Number.isNaN(draft[field]) ? '' : draft[field]} onChange={(e) => setDraft({ ...draft, [field]: e.target.value === '' ? NaN : Number(e.target.value) })} /></label>)}</div>
      {ruleError && <p role="alert">{ruleError}</p>}
      <div className="request-modal-actions"><button type="button" className="secondary-button" onClick={() => apply(DEFAULT_VPI_RULES)}>Reset defaults</button><button type="button" className="verify-button" disabled={Boolean(ruleError)} onClick={() => apply(draft)}>Apply demo rules</button></div>
      <p>These settings are stored on this browser only. Default points: age 2; assisted mobility 2; non-ambulatory 4; disability 2; pregnancy 3. Default bands: low 0–2, moderate 3–5, high 6+.</p>
    </details>
    {error && <p role="alert">{error}</p>}
    {scored.length === 0 && <p className="empty-state">No resident profiles available.</p>}
    <div className="vpi-list">{scored.map(({ resident, vpi }) => <details className="vpi-resident" key={resident.id}>
      <summary><span><strong>{resident.name}</strong><small>{resident.sitio}</small></span><span className={`vpi-badge vpi-${vpi.level.toLowerCase()}`}>{vpi.level === 'Incomplete' ? `Incomplete · subtotal ${vpi.score}` : `Demo ${vpi.level} · ${vpi.score}/${vpi.maxScore}`}</span></summary>
      {vpi.factors.length > 0 ? <ul>{vpi.factors.map((factor) => <li key={factor.label}>{factor.label}: +{factor.points}</li>)}</ul> : <p>No scored factors recorded.</p>}
      {vpi.age !== null && <p>Age: {vpi.age} years</p>}
      {vpi.missing.length > 0 && <p className="vpi-missing">Needs assessment: {vpi.missing.join(', ')}. A missing value is not treated as a confirmed absence.</p>}
      <small>Formula: {vpi.version} · Open Verification → Edit Resident to update the underlying profile.</small>
    </details>)}</div>
  </section>
}
