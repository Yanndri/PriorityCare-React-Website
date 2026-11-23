// Data mining 2: Evacuation Center Demand vs Capacity.
// Same rule the app uses to send people: every household goes to the NEAREST OPEN center.
// For each household with a home pin, find the nearest open center (straight line), then per center:
// expected evacuees = people in those households, people needing help = cannot walk + need help walking,
// use = expected / capacity. Status: Over above 100%, Tight from 80%, otherwise Enough.
import type { EvacuationCenter, Resident } from '../types/dashboard'
import { scoreHouseholds } from './householdVpi'
import { haversineKm } from './geo'

export type DemandStatus = 'Over' | 'Tight' | 'Enough' | 'No capacity set'

const isOpen = (c: EvacuationCenter) => c.status.toLowerCase() !== 'closed' && !c.closedAt

export function centerDemand(residents: Resident[], centers: EvacuationCenter[]) {
  const open = centers.filter((c) => isOpen(c) && Number.isFinite(Number(c.gpsLat)) && Number.isFinite(Number(c.gpsLong)) && c.gpsLat != null && c.gpsLong != null)
  const rows = new Map(open.map((c) => [c, { expected: 0, needHelp: 0, households: 0, barangays: new Set<string>() }]))
  let noPin = 0
  for (const h of scoreHouseholds(residents)) {
    if (h.lat == null || h.lng == null || !open.length) { noPin += 1; continue }
    let best = open[0], bestKm = Infinity
    for (const c of open) {
      const km = haversineKm([h.lat, h.lng], [Number(c.gpsLat), Number(c.gpsLong)])
      if (km < bestKm) { best = c; bestKm = km }
    }
    const row = rows.get(best)!
    row.expected += h.size
    row.needHelp += h.counts.nonAmbulatoryCount + h.counts.semiCount
    row.households += 1
    if (h.barangay) row.barangays.add(h.barangay)
  }
  const list = [...rows.entries()]
    .filter(([, r]) => r.households > 0)
    .map(([c, r]) => {
      const capacity = c.capacity ?? 0
      const use = capacity > 0 ? r.expected / capacity : null
      const status: DemandStatus = use === null ? 'No capacity set' : use > 1 ? 'Over' : use >= 0.8 ? 'Tight' : 'Enough'
      return { id: c.id ?? c.name, name: c.name, barangays: [...r.barangays].sort(), households: r.households, expected: r.expected, needHelp: r.needHelp, capacity, use, status }
    })
    .sort((a, b) => (b.use ?? -1) - (a.use ?? -1))
  return { rows: list, noPin }
}
