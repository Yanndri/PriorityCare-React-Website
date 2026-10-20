import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { getEquipmentRules, saveEquipmentRule } from '../api/equipmentRulesApi'
import { MATCH_KIND_LABELS } from '../utils/equipmentMatch'
import type { EquipmentRule, EquipmentRuleSet, MatchKind } from '../utils/equipmentMatch'

type Draft = { ruleId: number | null; kind: MatchKind; value: string; equipment: string; note: string; active: boolean }
const KINDS = Object.keys(MATCH_KIND_LABELS) as MatchKind[]
const MOBILITY = ['non_ambulatory', 'semi_ambulatory', 'ambulatory']

function describe(r: EquipmentRule) {
  if (r.match_kind === 'pregnancy') return 'Is pregnant'
  if (r.match_kind === 'mobility') return `Mobility is ${r.match_value.replace('_', '-')}`
  if (r.match_kind === 'needs_keyword') return `Needs text mentions “${r.match_value}”`
  return `${MATCH_KIND_LABELS[r.match_kind]} ${r.match_value}`
}

/** Module 5.4 — editable rules that map profile facts to rescue equipment. Super admins edit; everyone reads. */
export function EquipmentRulesPanel() {
  const [data, setData] = useState<EquipmentRuleSet | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function load() {
    try { setData(await getEquipmentRules()); setError('') }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to load equipment rules.') }
  }
  useEffect(() => {
    let cancelled = false
    getEquipmentRules().then(d => { if (!cancelled) setData(d) })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Unable to load equipment rules.') })
    return () => { cancelled = true }
  }, [])

  async function save(d: Draft, done: string) {
    setBusy(true); setError(''); setNotice('')
    try { await saveEquipmentRule(d); setDraft(null); setNotice(done); await load() }
    catch (e) { setError(e instanceof Error ? e.message : 'Save failed.') }
    finally { setBusy(false) }
  }
  function submit(e: FormEvent) {
    e.preventDefault()
    if (draft) void save(draft, draft.ruleId ? 'Rule updated.' : 'Rule added.')
  }
  const edit = (r: EquipmentRule) => setDraft({ ruleId: r.rule_id ?? null, kind: r.match_kind, value: r.match_value, equipment: r.equipment, note: r.note, active: r.is_active })

  const rules = data?.rules ?? []
  return <section className="panel">
    <div className="dispatch-head">
      <div><h3>Equipment rules</h3>
        <p className="dispatch-muted">Each rule says: when a resident (or a listed household dependent) matches, suggest this equipment. Dispatch tickets and resident profiles use these rules. Suggestions only — trained personnel confirm what is appropriate.</p></div>
      {data?.can_edit && <button type="button" className="primary-button" disabled={busy}
        onClick={() => setDraft({ ruleId: null, kind: 'needs_keyword', value: '', equipment: '', note: '', active: true })}>New rule</button>}
    </div>
    {!data?.can_edit && data && <p className="dispatch-muted">Rules apply to every barangay, so only a super admin can change them.</p>}
    {error && <p role="alert" className="dispatch-error">{error}</p>}
    {notice && <p role="status" className="dispatch-notice">{notice}</p>}

    {draft && data && <form className="unit-form" onSubmit={submit}>
      <fieldset className="dispatch-form" disabled={busy}>
        <label>When<select value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value as MatchKind, value: e.target.value === 'pregnancy' ? 'true' : '' })}>
          {KINDS.map(k => <option key={k} value={k}>{MATCH_KIND_LABELS[k]}</option>)}</select></label>
        <label>Value
          {draft.kind === 'mobility' ? <select required value={draft.value} onChange={e => setDraft({ ...draft, value: e.target.value })}>
              <option value="">Choose…</option>{MOBILITY.map(m => <option key={m} value={m}>{m.replace('_', '-')}</option>)}</select>
            : draft.kind === 'disability' ? <select required value={draft.value} onChange={e => setDraft({ ...draft, value: e.target.value })}>
              <option value="">Choose…</option>{data.disability_types.map(d => <option key={d} value={d}>{d}</option>)}</select>
            : draft.kind === 'pregnancy' ? <input value="yes" disabled />
            : draft.kind === 'needs_keyword' ? <input required maxLength={60} value={draft.value} placeholder="e.g. cpap, nebulizer" onChange={e => setDraft({ ...draft, value: e.target.value })} />
            : <input required type="number" min={0} max={130} step={1} value={draft.value} onChange={e => setDraft({ ...draft, value: e.target.value })} />}</label>
        <label>Suggest equipment<input required maxLength={60} value={draft.equipment} placeholder="e.g. Oxygen" onChange={e => setDraft({ ...draft, equipment: e.target.value })} /></label>
        <label>Why (shown to dispatchers)<input maxLength={300} value={draft.note} onChange={e => setDraft({ ...draft, note: e.target.value })} /></label>
        <label className="dispatch-chip"><input type="checkbox" checked={draft.active} onChange={e => setDraft({ ...draft, active: e.target.checked })} />Active</label>
        <div className="wide ticket-actions">
          <button type="submit" className="primary-button">{busy ? 'Saving…' : 'Save rule'}</button>
          <button type="button" className="secondary-button" onClick={() => setDraft(null)}>Cancel</button>
        </div>
      </fieldset>
    </form>}

    {data && <div className="catchment-table-wrap"><table className="dispatch-rules-table">
      <thead><tr><th>When</th><th>Suggest</th><th>Why</th><th>Status</th>{data.can_edit && <th />}</tr></thead>
      <tbody>{rules.map(r => <tr key={r.rule_id} className={r.is_active ? '' : 'inactive'}>
        <td>{describe(r)}</td>
        <td><span className="ticket-equip"><span>{r.equipment}</span></span></td>
        <td className="dispatch-muted">{r.note}{r.updated_by_name ? ` · edited by ${r.updated_by_name}` : ''}</td>
        <td>{r.is_active ? 'Active' : 'Off'}</td>
        {data.can_edit && <td className="ticket-actions">
          <button type="button" className="secondary-button" disabled={busy} onClick={() => edit(r)}>Edit</button>
          <button type="button" className="secondary-button" disabled={busy}
            onClick={() => void save({ ruleId: r.rule_id ?? null, kind: r.match_kind, value: r.match_value, equipment: r.equipment, note: r.note, active: !r.is_active },
              r.is_active ? 'Rule turned off.' : 'Rule turned on.')}>{r.is_active ? 'Turn off' : 'Turn on'}</button></td>}
      </tr>)}</tbody>
    </table></div>}
  </section>
}
