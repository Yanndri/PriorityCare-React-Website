// Data mining 1: Rescue Priority Zones (weighted K-means clustering).
// Input: households whose VPI is ASSISTED or CRITICAL (score 40+) and that have a home pin.
// 1. Each household is a point [x, y] in km (lat/lng projected around Cordova), weighted by its VPI.
// 2. Weighted K-means groups the points into k zones; each zone's centre is the VPI-weighted mean.
// 3. k is picked with the elbow method: run k = 1..8 and stop at the first k where going to k+1
//    lowers the error (SSE, weighted sum of squared km) by less than 25%. k is at most 8 and at most
//    households / 3, so every zone holds a few households on average.
// Plain TypeScript, no library. A fixed random seed keeps the result the same on every load.
import type { Resident } from '../types/dashboard'
import { scoreHouseholds } from './householdVpi'
import { haversineKm } from './shelterCatchments'
import { VPI_ASSISTED_AT, VPI_CRITICAL_AT } from './vpi'

export const MAX_K = 8
export const ELBOW_DROP = 0.25
// A zone should hold a few households, so k is also capped at households / 3 (a small barangay gets fewer zones).
export const MIN_PER_ZONE = 3

type Household = ReturnType<typeof scoreHouseholds>[number] & { lat: number; lng: number }
type Pt = { x: number; y: number; w: number }

export type Zone = {
  label: string
  lat: number
  lng: number
  radiusKm: number
  households: Household[]
  critical: number
  cannotWalk: number
  needsHelp: number
  people: number
  meanVpi: number
  nearestCenter: { name: string; km: number } | null
}

// Small seeded random generator (mulberry32) so the zones never change between reloads.
function seeded(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const d2 = (a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2

// One weighted K-means run with k-means++ starting centres. Returns each point's zone and the SSE.
function kmeansOnce(pts: Pt[], k: number, rand: () => number) {
  const centres: { x: number; y: number }[] = [pts[Math.floor(rand() * pts.length)]]
  while (centres.length < k) {
    // k-means++: the next start is picked with chance proportional to weight x squared distance.
    const far = pts.map((p) => p.w * Math.min(...centres.map((c) => d2(p, c))))
    let r = rand() * far.reduce((t, v) => t + v, 0)
    let i = 0
    while (i < pts.length - 1 && r > far[i]) { r -= far[i]; i++ }
    centres.push({ x: pts[i].x, y: pts[i].y })
  }
  let assign = new Array<number>(pts.length).fill(-1)
  for (let round = 0; round < 100; round++) {
    const next = pts.map((p) => {
      let best = 0
      for (let c = 1; c < k; c++) if (d2(p, centres[c]) < d2(p, centres[best])) best = c
      return best
    })
    const moved = next.some((c, i) => c !== assign[i])
    assign = next
    for (let c = 0; c < k; c++) {
      const members = pts.filter((_, i) => assign[i] === c)
      const w = members.reduce((t, p) => t + p.w, 0)
      if (w > 0) centres[c] = { x: members.reduce((t, p) => t + p.w * p.x, 0) / w, y: members.reduce((t, p) => t + p.w * p.y, 0) / w }
    }
    if (!moved) break
  }
  const sse = pts.reduce((t, p, i) => t + p.w * d2(p, centres[assign[i]]), 0)
  return { assign, sse }
}

// Best of 10 runs (lowest SSE), as is usual for K-means.
function kmeans(pts: Pt[], k: number) {
  const rand = seeded(42 + k)
  let best = kmeansOnce(pts, k, rand)
  for (let run = 1; run < 10; run++) {
    const next = kmeansOnce(pts, k, rand)
    if (next.sse < best.sse) best = next
  }
  return best
}

export function priorityZones(residents: Resident[], centers: { name: string; gpsLat?: number; gpsLong?: number; status: string }[]) {
  const households = scoreHouseholds(residents)
    .filter((h): h is Household => h.score >= VPI_ASSISTED_AT && h.lat !== null && h.lng !== null)
  if (!households.length) return { households, elbow: [] as { k: number; sse: number }[], k: 0, zones: [] as Zone[] }

  // Project to km so distances are fair in both directions.
  const lat0 = households.reduce((t, h) => t + h.lat, 0) / households.length
  const kx = 111.32 * Math.cos((lat0 * Math.PI) / 180), ky = 110.57
  const pts: Pt[] = households.map((h) => ({ x: h.lng * kx, y: h.lat * ky, w: h.score }))

  // Elbow method.
  const maxK = Math.max(1, Math.min(MAX_K, Math.floor(pts.length / MIN_PER_ZONE)))
  const runs = Array.from({ length: maxK }, (_, i) => ({ k: i + 1, ...kmeans(pts, i + 1) }))
  let pick = runs[runs.length - 1]
  for (let i = 0; i < runs.length - 1; i++) {
    const drop = runs[i].sse === 0 ? 0 : (runs[i].sse - runs[i + 1].sse) / runs[i].sse
    if (drop < ELBOW_DROP) { pick = runs[i]; break }
  }

  const open = centers.filter((c) => c.gpsLat && c.gpsLong && c.status.toLowerCase() === 'active')
  const zones: Zone[] = []
  for (let c = 0; c < pick.k; c++) {
    const members = households.filter((_, i) => pick.assign[i] === c)
    if (!members.length) continue
    const w = members.reduce((t, h) => t + h.score, 0)
    const lat = members.reduce((t, h) => t + h.score * h.lat, 0) / w
    const lng = members.reduce((t, h) => t + h.score * h.lng, 0) / w
    const nearest = open
      .map((x) => ({ name: x.name, km: haversineKm([lat, lng], [Number(x.gpsLat), Number(x.gpsLong)]) }))
      .sort((a, b) => a.km - b.km)[0] ?? null
    zones.push({
      label: '', lat, lng,
      radiusKm: Math.max(0.05, ...members.map((h) => haversineKm([lat, lng], [h.lat, h.lng]))),
      households: members,
      critical: members.filter((h) => h.score >= VPI_CRITICAL_AT).length,
      cannotWalk: members.reduce((t, h) => t + h.counts.nonAmbulatoryCount, 0),
      needsHelp: members.reduce((t, h) => t + h.counts.semiCount, 0),
      people: members.reduce((t, h) => t + h.size, 0),
      meanVpi: Math.round(w / members.length),
      nearestCenter: nearest,
    })
  }
  // Zone A is visited first: most CRITICAL households, then most households.
  zones.sort((a, b) => b.critical - a.critical || b.households.length - a.households.length)
  zones.forEach((z, i) => { z.label = `Zone ${String.fromCharCode(65 + i)}` })
  return { households, elbow: runs.map((r) => ({ k: r.k, sse: r.sse })), k: pick.k, zones }
}
