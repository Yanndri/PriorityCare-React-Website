// Module 5.4 — match extraction equipment to a resident's medical / vulnerability profile.
// Pure helpers (no Supabase) so they can be unit-tested. Suggestions only; trained personnel confirm.
import type { Resident } from '../types/dashboard'
import { vpiToday } from './vpi.ts'

export type MatchKind = 'mobility' | 'disability' | 'pregnancy' | 'age_under' | 'age_at_least' | 'needs_keyword'

export type EquipmentRule = {
  rule_id?: number
  match_kind: MatchKind
  match_value: string
  equipment: string
  note: string
  is_active: boolean
  updated_at?: string | null
  updated_by_name?: string | null
}

export type EquipmentRuleSet = { can_edit: boolean; disability_types: string[]; rules: EquipmentRule[] }

export const MATCH_KIND_LABELS: Record<MatchKind, string> = {
  mobility: 'Mobility is',
  disability: 'Has disability',
  pregnancy: 'Is pregnant',
  age_under: 'Age under',
  age_at_least: 'Age at least',
  needs_keyword: 'Needs text mentions',
}

const r = (match_kind: MatchKind, match_value: string, equipment: string, note: string): EquipmentRule =>
  ({ match_kind, match_value, equipment, note, is_active: true })

/** Same defaults the migration seeds; used if the rules cannot be loaded. */
export const DEFAULT_EQUIPMENT_RULES: EquipmentRule[] = [
  r('mobility', 'non_ambulatory', 'Stretcher / spineboard', 'Cannot walk; carry out lying down'),
  r('mobility', 'semi_ambulatory', 'Wheelchair', 'Can stand or walk short distances with help'),
  r('disability', 'Physical', 'Wheelchair', 'Physical disability; confirm on scene'),
  r('disability', 'Visual', 'Guide rope / sighted escort', 'Low or no vision'),
  r('disability', 'Hearing', 'Written cards / light signals', 'Cannot rely on spoken or siren instructions'),
  r('disability', 'Intellectual', 'Familiar companion / calm escort', 'May need simple, patient instructions'),
  r('disability', 'Psychosocial', 'Familiar companion / calm escort', 'Reduce stress during extraction'),
  r('pregnancy', 'true', 'First aid kit', 'Pregnancy recorded'),
  r('age_under', '5', 'Infant kit', 'Infant or toddler'),
  r('age_at_least', '80', 'Wheelchair', 'Very elderly; long walks may not be safe'),
  r('needs_keyword', 'oxygen', 'Oxygen', 'Needs oxygen support'),
  r('needs_keyword', 'bedridden', 'Stretcher / spineboard', 'Bedridden mentioned in needs'),
  r('needs_keyword', 'wheelchair', 'Wheelchair', 'Uses a wheelchair'),
  r('needs_keyword', 'dialysis', 'Medical transport', 'Needs regular dialysis'),
  r('needs_keyword', 'insulin', 'Medicine cooler', 'Insulin must stay cool'),
  r('needs_keyword', 'seizure', 'First aid kit', 'Seizure history'),
  r('needs_keyword', 'cane', 'Walking aid', 'Uses a cane'),
]

function ageOn(birthdate: string | undefined, asOf: string) {
  if (!birthdate || !/^\d{4}-\d{2}-\d{2}$/.test(birthdate) || birthdate > asOf) return null
  return Number(asOf.slice(0, 4)) - Number(birthdate.slice(0, 4)) - (asOf.slice(5) < birthdate.slice(5) ? 1 : 0)
}

/** Whole-word, case-insensitive match so "cane" does not match "hurricane". */
function mentions(text: string | undefined, keyword: string) {
  if (!text || !keyword.trim()) return false
  const k = keyword.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^a-z])${k}([^a-z]|$)`, 'i').test(text)
}

type Person = { label: string | null; mobility?: string; disabilities: string[]; pregnant?: boolean; age: number | null; needs?: string }

function ruleMatches(rule: EquipmentRule, p: Person) {
  const v = rule.match_value
  switch (rule.match_kind) {
    case 'mobility': return p.mobility === v
    case 'disability': return p.disabilities.some(d => d.toLowerCase() === v.toLowerCase())
    case 'pregnancy': return p.pregnant === true
    case 'age_under': return p.age !== null && p.age < Number(v)
    case 'age_at_least': return p.age !== null && p.age >= Number(v)
    case 'needs_keyword': return mentions(p.needs, v)
  }
}

export type EquipmentNeed = { equipment: string; reasons: string[] }

/**
 * Equipment suggested for a resident and their listed household dependents (dependents have no
 * account, so only age, pregnancy and their needs text are checked). Deduplicated by equipment.
 */
export function matchEquipment(resident: Resident | undefined, rules: EquipmentRule[] = DEFAULT_EQUIPMENT_RULES, asOf = vpiToday()): EquipmentNeed[] {
  if (!resident) return []
  const people: Person[] = [{
    label: null, mobility: resident.mobilityStatus, disabilities: resident.disabilityTypes ?? [],
    pregnant: resident.isPregnant, age: ageOn(resident.birthdate, asOf), needs: resident.vulnerabilityNeeds,
  }, ...(resident.householdMembers ?? []).map(m => ({
    label: m.name || 'dependent', disabilities: [], pregnant: m.is_pregnant, age: ageOn(m.birthdate, asOf), needs: m.needs,
  }))]
  const out = new Map<string, EquipmentNeed>()
  for (const rule of rules) {
    if (!rule.is_active) continue
    for (const p of people) {
      if (!ruleMatches(rule, p)) continue
      const key = rule.equipment.trim()
      const need = out.get(key.toLowerCase()) ?? { equipment: key, reasons: [] }
      const reason = `${p.label ? `${p.label}: ` : ''}${rule.note || `${MATCH_KIND_LABELS[rule.match_kind]} ${rule.match_value}`}`
      if (!need.reasons.includes(reason)) need.reasons.push(reason)
      out.set(key.toLowerCase(), need)
    }
  }
  return [...out.values()]
}

/** What the profile could not tell us, so "no equipment" is not mistaken for "checked and none needed". */
export function equipmentDataGaps(resident: Resident | undefined) {
  if (!resident) return []
  const gaps: string[] = []
  if (!resident.mobilityStatus) gaps.push('mobility')
  if (resident.disabilityTypes === undefined) gaps.push('disability assessment')
  if (resident.isPregnant === undefined) gaps.push('pregnancy')
  if (!resident.birthdate) gaps.push('birthdate')
  if (!resident.vulnerabilityNeeds) gaps.push('assistance needs')
  return gaps
}
