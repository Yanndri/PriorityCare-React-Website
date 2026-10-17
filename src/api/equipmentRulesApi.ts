import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { DEFAULT_EQUIPMENT_RULES } from '../utils/equipmentMatch'
import type { EquipmentRule, EquipmentRuleSet, MatchKind } from '../utils/equipmentMatch'

function rulesError(error: { code?: string; message: string }) {
  return new Error(error.code === 'PGRST202'
    ? 'Equipment rules need the 20261017_equipment_matching_rules.sql database migration.'
    : error.message)
}

export async function getEquipmentRules(): Promise<EquipmentRuleSet> {
  const { data, error } = await supabase.rpc('get_equipment_rules')
  if (error) throw rulesError(error)
  return data as EquipmentRuleSet
}

export async function saveEquipmentRule(rule: { ruleId: number | null; kind: MatchKind; value: string; equipment: string; note: string; active: boolean }) {
  const { data, error } = await supabase.rpc('save_equipment_rule', {
    p_rule_id: rule.ruleId, p_kind: rule.kind, p_value: rule.value.trim(), p_equipment: rule.equipment.trim(),
    p_note: rule.note.trim(), p_active: rule.active,
  })
  if (error) throw rulesError(error)
  return data as number
}

/** Live rules from the database; falls back to the built-in defaults if they cannot be loaded. */
export function useEquipmentRules() {
  const [rules, setRules] = useState<EquipmentRule[]>(DEFAULT_EQUIPMENT_RULES)
  const [usingDefaults, setUsingDefaults] = useState(true)
  useEffect(() => {
    let cancelled = false
    getEquipmentRules().then(d => { if (!cancelled) { setRules(d.rules); setUsingDefaults(false) } }).catch(() => undefined)
    return () => { cancelled = true }
  }, [])
  return { rules, usingDefaults }
}
