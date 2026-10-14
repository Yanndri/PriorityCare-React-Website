import type { Resident } from '../types/dashboard'

export const VPI_VERSION = 'prototype-v1'
export type VpiRules = {
  age: number
  semiAmbulatory: number
  nonAmbulatory: number
  disability: number
  pregnancy: number
  moderateAt: number
  highAt: number
}
export const DEFAULT_VPI_RULES: VpiRules = {
  age: 2, semiAmbulatory: 2, nonAmbulatory: 4, disability: 2,
  pregnancy: 3, moderateAt: 3, highAt: 6,
}
export function vpiToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}
export function validateVpiRules(rules: VpiRules) {
  if ((Object.keys(DEFAULT_VPI_RULES) as (keyof VpiRules)[]).some((key) => !Number.isInteger(rules[key]) || rules[key] < 0 || rules[key] > 30)) {
    return 'Use whole numbers from 0 to 30.'
  }
  if (rules.moderateAt < 1 || rules.highAt <= rules.moderateAt) {
    return 'Moderate must start at 1 or higher; high must start above moderate.'
  }
  return ''
}
function validDate(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

// Prototype only: transparent demonstration weights, not a validated triage score.
export function calculateVpi(resident: Resident, rules: VpiRules = DEFAULT_VPI_RULES, asOf = vpiToday()) {
  const validation = validateVpiRules(rules)
  if (validation) throw new Error(validation)
  if (!validDate(asOf)) throw new Error('Invalid calculation date.')
  const missing: string[] = []
  const factors: { label: string; points: number }[] = []
  let age: number | null = null
  if (!validDate(resident.birthdate) || resident.birthdate! > asOf) {
    missing.push('valid birthdate')
  } else {
    const birth = resident.birthdate!
    age = Number(asOf.slice(0, 4)) - Number(birth.slice(0, 4)) - (asOf.slice(5) < birth.slice(5) ? 1 : 0)
    if (age < 5 || age >= 60) factors.push({ label: age < 5 ? 'Under 5 years' : '60 years or older', points: rules.age })
  }
  let mobilityPoints = 0
  if (resident.mobilityStatus === 'non_ambulatory') mobilityPoints = rules.nonAmbulatory
  else if (resident.mobilityStatus === 'semi_ambulatory') mobilityPoints = rules.semiAmbulatory
  else if (resident.mobilityStatus !== 'ambulatory') missing.push('mobility assessment')
  let disabilityPoints = 0
  if (resident.disabilityCount === undefined) missing.push('disability assessment')
  else if (resident.disabilityCount > 0) disabilityPoints = rules.disability
  // Mobility and disability often overlap. Count only the larger demo contribution.
  const assistancePoints = Math.max(mobilityPoints, disabilityPoints)
  if (assistancePoints > 0) factors.push({ label: 'Mobility / disability assistance (maximum, not sum)', points: assistancePoints })
  if (resident.isPregnant === undefined) missing.push('pregnancy assessment')
  else if (resident.isPregnant) factors.push({ label: 'Pregnancy recorded', points: rules.pregnancy })
  const score = factors.reduce((sum, factor) => sum + factor.points, 0)
  const maxScore = rules.age + Math.max(rules.semiAmbulatory, rules.nonAmbulatory, rules.disability) + rules.pregnancy
  const level = missing.length > 0 ? 'Incomplete' : score >= rules.highAt ? 'High' : score >= rules.moderateAt ? 'Moderate' : 'Low'
  return { score, maxScore, level, factors, missing, age, asOf, version: VPI_VERSION }
}
