// Data mining 2: Evacuation Center Demand vs Capacity.
// For each center: the barangays whose shelter plan names it as their primary center,
// expected evacuees = registered people in those barangays (residents + household members),
// people needing help = cannot walk + need help walking, use = expected / capacity.
// Status: Over above 100%, Tight from 80%, otherwise Enough.
import type { Resident } from '../types/dashboard'
import { scoreHouseholds } from './householdVpi'
import { barangayPopulation, type ShelterPlanData } from './shelterCatchments'

export type DemandStatus = 'Over' | 'Tight' | 'Enough' | 'No capacity set'

export function centerDemand(plan: ShelterPlanData, residents: Resident[], scopeBarangayId: number | null) {
  const help = new Map<string, number>()
  for (const h of scoreHouseholds(residents)) {
    help.set(h.barangay, (help.get(h.barangay) ?? 0) + h.counts.nonAmbulatoryCount + h.counts.semiCount)
  }
  const byId = new Map(plan.barangays.map((b) => [b.barangay_id, b]))
  return plan.centers
    .filter((c) => c.primary_for.length > 0)
    .filter((c) => scopeBarangayId === null || c.primary_for.includes(scopeBarangayId) || c.barangay_id === scopeBarangayId)
    .map((c) => {
      const served = c.primary_for.map((id) => byId.get(id)).filter((b) => b !== undefined)
      const expected = served.reduce((t, b) => t + barangayPopulation(b), 0)
      const needHelp = served.reduce((t, b) => t + (help.get(b.barangay_name) ?? 0), 0)
      const capacity = c.capacity ?? 0
      const use = capacity > 0 ? expected / capacity : null
      const status: DemandStatus = use === null ? 'No capacity set' : use > 1 ? 'Over' : use >= 0.8 ? 'Tight' : 'Enough'
      return { id: c.center_id, name: c.center_name, barangays: served.map((b) => b.barangay_name), expected, needHelp, capacity, use, status }
    })
    .sort((a, b) => (b.use ?? -1) - (a.use ?? -1))
}
