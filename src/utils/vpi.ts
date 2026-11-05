// Vulnerability Priority Index (VPI): ONE household score from 0 to 100.
// The Expo app has the same rules in src/utils/vpi.js; change both together.
//
//   Mobility (whole household)  cannot walk / bedridden / wheelchair: 30, +5 per extra person (max 40)
//                               otherwise needs help walking: 18, +4 per extra person (max 26)
//   Dependents (max 35)         pregnant: 18 · children under 12: 8 each (max 16) · seniors 60+: 6 each (max 12)
//   House                       light materials: 25 · mixed: 12 · concrete: 0
//   Bands                       CRITICAL 70+ · ASSISTED 40–69 · LOW below 40
//
// Prototype weights chosen by the team; not an official DSWD/NDRRMC scale.

export const VPI_VERSION = 'household-v1'
export const VPI_CRITICAL_AT = 70
export const VPI_ASSISTED_AT = 40
export type VpiPriority = 'CRITICAL' | 'ASSISTED' | 'LOW'
export const VPI_LABELS: Record<VpiPriority, string> = { CRITICAL: 'Critical', ASSISTED: 'Assisted', LOW: 'Low' }

export type VpiCounts = {
  nonAmbulatoryCount: number
  semiCount: number
  childrenCount: number
  seniorsCount: number
  pregnantCount: number
}
export type VpiPerson = {
  mobility?: string | null
  age_group?: string | null
  birthdate?: string | null
  is_pregnant?: boolean | null
}

const NON_AMBULATORY = ['non_ambulatory', 'bedridden', 'wheelchair']
const SEMI_AMBULATORY = ['semi_ambulatory', 'assisted']

export function vpiToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

export function ageOn(birthdate: string | null | undefined, asOf = vpiToday()) {
  if (!birthdate || !/^\d{4}-\d{2}-\d{2}/.test(birthdate)) return null
  const b = birthdate.slice(0, 10)
  if (b > asOf) return null
  return Number(asOf.slice(0, 4)) - Number(b.slice(0, 4)) - (asOf.slice(5) < b.slice(5) ? 1 : 0)
}

// Everyone in the household: account holders and listed members.
export function countVulnerable(people: VpiPerson[], asOf = vpiToday()): VpiCounts {
  const counts: VpiCounts = { nonAmbulatoryCount: 0, semiCount: 0, childrenCount: 0, seniorsCount: 0, pregnantCount: 0 }
  for (const p of people) {
    const age = ageOn(p.birthdate, asOf)
    if (NON_AMBULATORY.includes(p.mobility ?? '')) counts.nonAmbulatoryCount++
    else if (SEMI_AMBULATORY.includes(p.mobility ?? '')) counts.semiCount++
    if (p.age_group === 'infant' || p.age_group === 'child' || (!p.age_group && age !== null && age < 12)) counts.childrenCount++
    if (p.age_group === 'senior' || (age !== null && age >= 60)) counts.seniorsCount++
    if (p.is_pregnant) counts.pregnantCount++
  }
  return counts
}

export function vpiBreakdown(counts: Partial<VpiCounts>, houseType?: string | null) {
  const n = (v: unknown) => Math.max(0, Math.trunc(Number(v)) || 0)
  const nonAmb = n(counts.nonAmbulatoryCount), semi = n(counts.semiCount)
  const preg = n(counts.pregnantCount), child = n(counts.childrenCount), senior = n(counts.seniorsCount)
  const factors: { label: string; points: number }[] = []
  if (nonAmb > 0) factors.push({ label: `${nonAmb} cannot walk`, points: Math.min(30 + (nonAmb - 1) * 5, 40) })
  else if (semi > 0) factors.push({ label: `${semi} needs help walking`, points: Math.min(18 + (semi - 1) * 4, 26) })
  const dependents = Math.min((preg > 0 ? 18 : 0) + Math.min(child * 8, 16) + Math.min(senior * 6, 12), 35)
  if (dependents > 0) {
    const who = [preg && `${preg} pregnant`, child && `${child} child${child > 1 ? 'ren' : ''}`, senior && `${senior} senior${senior > 1 ? 's' : ''}`]
    factors.push({ label: `Dependents: ${who.filter(Boolean).join(', ')}`, points: dependents })
  }
  if (houseType === 'light') factors.push({ label: 'Light-material house', points: 25 })
  else if (houseType === 'mixed') factors.push({ label: 'Mixed-material house', points: 12 })
  const score = Math.min(Math.round(factors.reduce((t, f) => t + f.points, 0)), 100)
  return { score, priority: getVPIPriority(score), factors }
}

export function calculateVPI(counts: Partial<VpiCounts> & { houseType?: string | null } = {}) {
  return vpiBreakdown(counts, counts.houseType).score
}

export function getVPIPriority(score = 0): VpiPriority {
  if (score >= VPI_CRITICAL_AT) return 'CRITICAL'
  if (score >= VPI_ASSISTED_AT) return 'ASSISTED'
  return 'LOW'
}
