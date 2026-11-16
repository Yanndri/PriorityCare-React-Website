import type { Resident } from '../types/dashboard'
import { countVulnerable, vpiBreakdown, vpiToday, type VpiPerson } from './vpi.ts'

// A resident's household VPI: the account holder plus everyone listed in their household,
// and the household's house type. Same rules as the app (see vpi.ts).
export function householdPeople(r: Resident): VpiPerson[] {
  const self: VpiPerson = { mobility: r.mobilityStatus, birthdate: r.birthdate, is_pregnant: r.isPregnant }
  return [self, ...(r.householdMembers ?? []).map((m) => ({
    mobility: m.mobility, age_group: m.age_group, birthdate: m.birthdate, is_pregnant: m.is_pregnant,
  }))]
}

export function residentVpi(r: Resident, asOf = vpiToday()) {
  return vpiBreakdown(countVulnerable(householdPeople(r), asOf), r.houseType)
}

// Every household (or lone resident) with its VPI, highest first.
export function scoreHouseholds(residents: Resident[], asOf = vpiToday()) {
  const groups = new Map<string, Resident[]>()
  for (const r of residents) {
    const key = r.householdId ? `hh:${r.householdId}` : `r:${r.id}`
    const list = groups.get(key)
    if (list) list.push(r); else groups.set(key, [r])
  }
  return [...groups.entries()].map(([key, people]) => {
    const members = people.find((p) => p.householdMembers?.length)?.householdMembers ?? []
    const everyone: VpiPerson[] = [
      ...people.map((p) => ({ mobility: p.mobilityStatus, birthdate: p.birthdate, is_pregnant: p.isPregnant })),
      ...members.map((m) => ({ mobility: m.mobility, age_group: m.age_group, birthdate: m.birthdate, is_pregnant: m.is_pregnant })),
    ]
    const houseType = people.find((p) => p.houseType)?.houseType ?? null
    const head = people.find((p) => p.isHouseholdHead) ?? people[0]
    const counts = countVulnerable(everyone, asOf)
    return {
      key, name: head.householdName ?? head.name, barangay: head.barangay, sitio: head.sitio ?? '',
      size: everyone.length, houseType, counts,
      ...vpiBreakdown(counts, houseType),
    }
  }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
}
