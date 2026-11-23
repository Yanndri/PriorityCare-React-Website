// Module 4.3 — Household triage pins color-coded by VPI urgency (Red / Yellow / Green).
// Pure functions so they can be unit-tested; rendering lives in components/TriagePinsLayer.tsx.
import type { Resident } from '../types/dashboard'
import { ageOn, countVulnerable, vpiBreakdown, vpiToday, type VpiPerson } from './vpi.ts'

export type TriageLevel = 'red' | 'yellow' | 'green'

export const TRIAGE_LEVELS: Record<TriageLevel, { label: string; short: string; color: string; ring: string; meaning: string }> = {
  red: { label: 'Red — Critical', short: 'C', color: '#dc2626', ring: '#7f1d1d', meaning: 'Household VPI 70 or more' },
  yellow: { label: 'Yellow — Assisted', short: 'A', color: '#eab308', ring: '#713f12', meaning: 'Household VPI 40 to 69' },
  green: { label: 'Green — Low', short: 'L', color: '#16a34a', ring: '#14532d', meaning: 'Household VPI below 40' },
}
export const TRIAGE_ORDER: TriageLevel[] = ['red', 'yellow', 'green']

export type TriageMember = {
  id: string
  name: string
  /** Why this person matters for the household score, e.g. "Cannot walk", "Senior". */
  tags: string[]
  hasAccount: boolean
}

export type TriagePin = {
  key: string
  position: [number, number]
  householdName: string | null
  barangay: string
  triage: TriageLevel
  /** Household VPI, 0–100 (same rules as the app). */
  score: number
  factors: { label: string; points: number }[]
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

const MOBILITY_TAGS: Record<string, string> = {
  non_ambulatory: 'Cannot walk', bedridden: 'Bedridden', wheelchair: 'Wheelchair',
  semi_ambulatory: 'Needs help walking', assisted: 'Needs help walking',
}

export function personTags(p: VpiPerson, asOf = vpiToday()) {
  const tags: string[] = []
  if (p.mobility && MOBILITY_TAGS[p.mobility]) tags.push(MOBILITY_TAGS[p.mobility])
  const age = ageOn(p.birthdate, asOf)
  if (p.age_group === 'infant' || p.age_group === 'child' || (!p.age_group && age !== null && age < 12)) tags.push('Child')
  if (p.age_group === 'senior' || (age !== null && age >= 60)) tags.push('Senior')
  if (p.is_pregnant) tags.push('Pregnant')
  return tags
}

const bandColour = { CRITICAL: 'red', ASSISTED: 'yellow', LOW: 'green' } as const

/**
 * One pin per household (or per resident with no household), coloured by the household VPI:
 * Red = Critical (70+), Yellow = Assisted (40–69), Green = Low.
 */
export function buildTriagePins(residents: Resident[], asOf = vpiToday()) {
  const groups = new Map<string, Resident[]>()
  for (const r of residents) {
    const key = r.householdId ? `hh:${r.householdId}` : `r:${r.id}`
    const list = groups.get(key)
    if (list) list.push(r); else groups.set(key, [r])
  }
  const pins: TriagePin[] = []
  let unmappedHouseholds = 0
  for (const [key, people] of groups) {
    const head = people.find(p => p.isHouseholdHead && position(p))
    const located = head ?? people.find(p => position(p))
    if (!located) { unmappedHouseholds++; continue }
    // Everyone counted once: each account holder, then the listed household members.
    const dependents = people.find(p => p.householdMembers?.length)?.householdMembers ?? []
    const everyone: VpiPerson[] = [
      ...people.map(p => ({ mobility: p.mobilityStatus, birthdate: p.birthdate, is_pregnant: p.isPregnant })),
      ...dependents.map(d => ({ mobility: d.mobility, age_group: d.age_group, birthdate: d.birthdate, is_pregnant: d.is_pregnant })),
    ]
    const houseType = people.find(p => p.houseType)?.houseType ?? null
    const vpi = vpiBreakdown(countVulnerable(everyone, asOf), houseType)
    const members: TriageMember[] = [
      ...people.map((p, i) => ({ id: String(p.id), name: p.name, tags: personTags(everyone[i], asOf), hasAccount: true })),
      ...dependents.map((d, i) => ({ id: `${key}:dep:${i}`, name: d.name || 'Unnamed member', tags: personTags(everyone[people.length + i], asOf), hasAccount: false })),
    ]
    members.sort((a, b) => b.tags.length - a.tags.length || Number(b.hasAccount) - Number(a.hasAccount) || a.name.localeCompare(b.name))
    pins.push({
      key, position: position(located)!, householdName: located.householdName ?? null, barangay: located.barangay,
      triage: bandColour[vpi.priority], score: vpi.score, factors: vpi.factors, members,
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
  return { pins, counts, unmappedHouseholds }
}
