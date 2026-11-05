import type { Resident } from '../types/dashboard'
import { scoreHouseholds } from '../utils/householdVpi'
import { VPI_LABELS } from '../utils/vpi'

// Household VPI (0–100), the same score rescuers see in the app.
const houseLabels: Record<string, string> = { light: 'light materials', mixed: 'mixed materials', concrete: 'concrete' }

export function VpiPanel({ residents }: { residents: Resident[] }) {
  const households = scoreHouseholds(residents)
  return <section className="panel prototype-vpi">
    <div className="section-header"><div><h3>Household vulnerability (VPI)</h3></div><span>{households.length} households</span></div>
    <p>Each household gets one score out of 100, the same score rescuers see in the app. Critical is 70 or more, Assisted is 40 to 69, Low is below 40.</p>
    <details className="vpi-settings">
      <summary>How the score is counted</summary>
      <ul>
        <li>Mobility: someone who cannot walk (bedridden, wheelchair) 30, +5 for each extra person, up to 40. Otherwise someone who needs help walking 18, +4 each, up to 26.</li>
        <li>Dependents, up to 35: pregnant 18; children under 12, 8 each (up to 16); seniors 60+, 6 each (up to 12).</li>
        <li>House: light materials 25, mixed 12, concrete 0.</li>
      </ul>
      <p>Team-chosen prototype weights. They support, not replace, responder judgement.</p>
    </details>
    {households.length === 0 && <p className="empty-state">No resident profiles available.</p>}
    <div className="vpi-list">{households.map((h) => <details className="vpi-resident" key={h.key}>
      <summary><span><strong>{h.name}</strong><small>{h.barangay} · {h.size} {h.size === 1 ? 'person' : 'people'}</small></span>
        <span className={`vpi-badge vpi-${h.priority === 'CRITICAL' ? 'high' : h.priority === 'ASSISTED' ? 'moderate' : 'low'}`}>{VPI_LABELS[h.priority]} · {h.score}/100</span></summary>
      {h.factors.length > 0 ? <ul>{h.factors.map((f) => <li key={f.label}>{f.label}: +{f.points}</li>)}</ul> : <p>No scored factors recorded.</p>}
      {!h.houseType ? <p className="vpi-missing">House type not recorded (counted as 0).</p> : <p>House: {houseLabels[h.houseType] ?? h.houseType}</p>}
    </details>)}</div>
  </section>
}
