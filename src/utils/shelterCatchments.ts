// Module 2.2 — sitio catchments mapped to designated primary / alternate shelters.
// Pure helpers (no Supabase) so they can be unit-tested.

export type PlanSitio = {
  sitio_id: number
  sitio_name: string
  editable: boolean
  residents: number
  dependents: number
  centroid_lat: number | string | null
  centroid_long: number | string | null
  primary_center_id: number | null
  alternate_center_ids: number[]
  note: string
  updated_at: string | null
  updated_by_name: string | null
}

export type PlanCenter = {
  center_id: number
  center_name: string
  status: string | null
  capacity: number | null
  gps_lat: number | string | null
  gps_long: number | string | null
  primary_for: number[]
  planned_population: number | string
}

export type ShelterPlanData = {
  generated_at: string
  can_edit_all: boolean
  sitios: PlanSitio[]
  centers: PlanCenter[]
}

export type LoadStatus = 'ok' | 'near' | 'over' | 'unknown' | 'unused'

/** Planned primary population vs. maximum safe capacity for one shelter. */
export function shelterLoad(center: PlanCenter) {
  const planned = Number(center.planned_population) || 0
  const capacity = center.capacity ?? null
  if (!center.primary_for.length) return { planned, capacity, ratio: null, status: 'unused' as LoadStatus }
  if (!capacity) return { planned, capacity, ratio: null, status: 'unknown' as LoadStatus }
  const ratio = planned / capacity
  return { planned, capacity, ratio, status: (ratio > 1 ? 'over' : ratio >= 0.85 ? 'near' : 'ok') as LoadStatus }
}

export function sitioPopulation(s: PlanSitio) {
  return (Number(s.residents) || 0) + (Number(s.dependents) || 0)
}

function point(lat: unknown, lng: unknown): [number, number] | null {
  if (lat === null || lat === undefined || lng === null || lng === undefined || lat === '' || lng === '') return null
  const a = Number(lat), b = Number(lng)
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 90 || Math.abs(b) > 180 || (a === 0 && b === 0)) return null
  return [a, b]
}

export type CatchmentLine = {
  key: string
  sitioId: number
  sitioName: string
  centerId: number
  centerName: string
  role: 'primary' | 'alternate'
  from: [number, number]
  to: [number, number]
  distanceKm: number
}

/** Straight-line links from each sitio's resident centroid to its assigned shelters (not road routes). */
export function catchmentLines(data: ShelterPlanData) {
  const centers = new Map(data.centers.map(c => [c.center_id, c]))
  const lines: CatchmentLine[] = []
  const missing: string[] = []
  for (const s of data.sitios) {
    if (s.primary_center_id === null) continue
    const from = point(s.centroid_lat, s.centroid_long)
    if (!from) { missing.push(`${s.sitio_name}: no resident GPS to place the sitio`); continue }
    const targets: [number, 'primary' | 'alternate'][] = [[s.primary_center_id, 'primary'], ...s.alternate_center_ids.map(id => [id, 'alternate'] as [number, 'alternate'])]
    for (const [id, role] of targets) {
      const c = centers.get(id)
      const to = c ? point(c.gps_lat, c.gps_long) : null
      if (!c || !to) { missing.push(`${s.sitio_name} → ${c?.center_name ?? `center ${id}`}: shelter has no GPS`); continue }
      lines.push({ key: `${s.sitio_id}-${id}`, sitioId: s.sitio_id, sitioName: s.sitio_name, centerId: id, centerName: c.center_name,
        role, from, to, distanceKm: haversineKm(from, to) })
    }
  }
  return { lines, missing }
}

export function haversineKm(a: [number, number], b: [number, number]) {
  const r = (d: number) => d * Math.PI / 180
  const h = Math.sin(r(b[0] - a[0]) / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(r(b[1] - a[1]) / 2) ** 2
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Client-side mirror of the server's checks, for instant feedback in the form. */
export function validatePlan(primary: number | null, alternates: number[], centers: PlanCenter[], note: string) {
  if (primary === null && alternates.length) return 'Choose a primary shelter before adding alternates.'
  if (alternates.length > 3) return 'Choose at most 3 alternate shelters.'
  const all = primary === null ? alternates : [primary, ...alternates]
  if (new Set(all).size !== all.length) return 'Each shelter can appear only once in a sitio plan.'
  if (primary !== null && centers.find(c => c.center_id === primary)?.status === 'closed') return 'A closed evacuation center cannot be a primary shelter.'
  if (note.length > 500) return 'Keep the note under 500 characters.'
  return ''
}
