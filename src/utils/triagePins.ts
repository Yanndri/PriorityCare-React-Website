// Module 4.3 — Household triage pins color-coded by VPI urgency (Red / Yellow / Green).
// Pure functions so they can be unit-tested; rendering lives in components/TriagePinsLayer.tsx.
import type { Resident } from '../types/dashboard'
import { calculateVpi, DEFAULT_VPI_RULES, vpiToday, type VpiRules } from './vpi.ts'

export type TriageLevel = 'red' | 'yellow' | 'green'

export const TRIAGE_LEVELS: Record<TriageLevel, { label: string; short: string; color: string; ring: string; meaning: string }> = {
  red: { label: 'Red — High priority', short: 'H', color: '#dc2626', ring: '#7f1d1d', meaning: 'Highest household VPI is in the High band' },
  yellow: { label: 'Yellow — Moderate', short: 'M', color: '#eab308', ring: '#713f12', meaning: 'Highest household VPI is in the Moderate band' },
  green: { label: 'Green — Low', short: 'L', color: '#16a34a', ring: '#14532d', meaning: 'All assessed members are in the Low band' },
}
export const TRIAGE_ORDER: TriageLevel[] = ['red', 'yellow', 'green']

export type TriageMember = {
  id: string
  name: string
  score: number
  level: 'High' | 'Moderate' | 'Low' | 'Incomplete'
  factors: string[]
  missing: string[]
  hasAccount: boolean
}

export type TriagePin = {
  key: string
  position: [number, number]
  householdName: string | null
  sitio: string
  triage: TriageLevel
  /** Highest member VPI score in the household. */
  score: number
  maxScore: number
  /** Some member's profile is missing assessments: the colour is a lower bound ("at least"). */
  incomplete: boolean
  members: TriageMember[]
  /** Account holders without a valid GPS position (still scored). */
  unmappedMembers: number
  floodZone: boolean
  contact: string | null
  positionSource: 'head' | 'member'
}

function position(r: Resident): [number, number] | null {
  if (r.gpsLat === null || r.gpsLat === undefined || r.gpsLong === null || r.gpsLong === undefined || r.gpsLat === '' || r.gpsLong === '') return null
  const lat = Number(r.gpsLat), lng = Number(r.gpsLong)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null
  return [lat, lng]
}

function ageOn(birthdate: string, asOf: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthdate) || birthdate > asOf) return null
  return Number(asOf.slice(0, 4)) - Number(birthdate.slice(0, 4)) - (asOf.slice(5) < birthdate.slice(5) ? 1 : 0)
}

/**
 * Dependents listed in households.household_members have no account, mobility or disability
 * assessment. Only the factors that can be known (age band, pregnancy) are scored, and the
 * member is always marked incomplete for the missing assessments.
 */
export function scoreDependent(d: { name?: string; birthdate?: string; is_pregnant?: boolean }, rules: VpiRules, asOf: string) {
  const factors: { label: string; points: number }[] = []
  const missing = ['mobility assessment', 'disability assessment']
  const age = d.birthdate ? ageOn(d.birthdate, asOf) : null
  if (age === null) missing.unshift('valid birthdate')
  else if (age < 5 || age >= 60) factors.push({ label: age < 5 ? 'Under 5 years' : '60 years or older', points: rules.age })
  if (d.is_pregnant) factors.push({ label: 'Pregnancy recorded', points: rules.pregnancy })
  return { score: factors.reduce((t, f) => t + f.points, 0), factors, missing }
}

function levelFor(score: number, rules: VpiRules) {
  return score >= rules.highAt ? 'High' : score >= rules.moderateAt ? 'Moderate' : 'Low'
}

/**
 * One pin per household (or per resident with no household). The household's colour is its most
 * urgent member's VPI band: Red = High, Yellow = Moderate, Green = Low. Members with incomplete
 * profiles are scored on their known factors only, so the pin is flagged `incomplete` and its colour
 * means "at least this urgent" — an assessment could only raise it.
 */
export function buildTriagePins(residents: Resident[], rules: VpiRules = DEFAULT_VPI_RULES, asOf = vpiToday()) {
  const groups = new Map<string, Resident[]>()
  for (const r of residents) {
    const key = r.householdId ? `hh:${r.householdId}` : `r:${r.id}`
    const list = groups.get(key)
    if (list) list.push(r); else groups.set(key, [r])
  }
  const maxScore = calculateVpi({ id: 'x', name: '', sitio: '', constraint: 'Walk Assist', status: 'Verified', floodZone: false, lastUpdated: '' } as Resident, rules, asOf).maxScore
  const pins: TriagePin[] = []
  let unmappedHouseholds = 0
  for (const [key, people] of groups) {
    const head = people.find(p => p.isHouseholdHead && position(p))
    const located = head ?? people.find(p => position(p))
    if (!located) { unmappedHouseholds++; continue }
    const members: TriageMember[] = people.map(p => {
      const v = calculateVpi(p, rules, asOf)
      return { id: String(p.id), name: p.name, score: v.score, level: v.level as TriageMember['level'],
        factors: v.factors.map(f => `${f.label} (+${f.points})`), missing: v.missing, hasAccount: true }
    })
    const dependents = people.find(p => p.householdMembers?.length)?.householdMembers ?? []
    dependents.forEach((d, i) => {
      const s = scoreDependent(d, rules, asOf)
      members.push({ id: `${key}:dep:${i}`, name: d.name || 'Unnamed dependent', score: s.score, level: 'Incomplete',
        factors: s.factors.map(f => `${f.label} (+${f.points})`), missing: s.missing, hasAccount: false })
    })
    const score = Math.max(0, ...members.map(m => m.score))
    const band = levelFor(score, rules)
    const incomplete = members.some(m => m.level === 'Incomplete')
    const triage: TriageLevel = band === 'High' ? 'red' : band === 'Moderate' ? 'yellow' : 'green'
    members.sort((a, b) => b.score - a.score || Number(b.hasAccount) - Number(a.hasAccount) || a.name.localeCompare(b.name))
    pins.push({
      key, position: position(located)!, householdName: located.householdName ?? null, sitio: located.sitio,
      triage, score, maxScore, incomplete, members,
      unmappedMembers: people.filter(p => !position(p)).length,
      floodZone: people.some(p => p.floodZone),
      contact: located.emergencyContactName
        ? `${located.emergencyContactName}${located.emergencyContactNo ? ` · ${located.emergencyContactNo}` : ''}` : null,
      positionSource: head ? 'head' : 'member',
    })
  }
  // Draw least urgent first so red pins sit on top where households overlap.
  const drawOrder: Record<TriageLevel, number> = { green: 0, yellow: 1, red: 2 }
  pins.sort((a, b) => drawOrder[a.triage] - drawOrder[b.triage] || a.score - b.score)
  const counts = Object.fromEntries(TRIAGE_ORDER.map(l => [l, pins.filter(p => p.triage === l).length])) as Record<TriageLevel, number>
  return { pins, counts, unmappedHouseholds, incomplete: pins.filter(p => p.incomplete).length }
}
