// Spatial demographic-vulnerability and incident heatmaps.
// Pure functions only so they can be unit-tested; rendering lives in components/SpatialHeatmapLayer.tsx.
import type { Resident } from '../types/dashboard'
import { calculateVpi, DEFAULT_VPI_RULES, vpiToday } from './vpi.ts'

export type HeatLayerKind = 'vulnerability' | 'incidents'
export type HeatPoint = {
  lat: number
  lng: number
  /** 0–1 contribution of this point. */
  weight: number
  /** Short category used in grid tooltips. */
  kind: string
}

export type IncidentInputs = {
  /** Latest evacuation status per resident uid. */
  latestStatus: { uid: string; status: string | null; loggedAt: string | null }[]
  /** Open missing-person reports linked to a registered resident. */
  openReports: { residentUid: string | null }[]
  sosAlerts: { residentUid: string; level: number; status: string | null; createdAt: string | null }[]
  /** Active disaster events with a reference point. */
  events: { lat: number | null; lng: number | null; status: string }[]
}

export const INCIDENT_WEIGHTS = {
  failedRescue: 1,
  missingReport: 1,
  disasterEvent: 1,
  sos: 0.8,
  pending: 0.6,
  inTransit: 0.4,
} as const

export const INCIDENT_LABELS: Record<string, string> = {
  failedRescue: 'Failed / not reached',
  missingReport: 'Open missing report',
  disasterEvent: 'Active disaster event',
  sos: 'Active SOS',
  pending: 'Rescue pending',
  inTransit: 'In transit',
  vulnerability: 'Vulnerable resident',
}

export function residentPosition(r: Resident): [number, number] | null {
  const lat = Number(r.gpsLat)
  const lng = Number(r.gpsLong)
  if (r.gpsLat === null || r.gpsLat === undefined || r.gpsLong === null || r.gpsLong === undefined) return null
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  if (lat === 0 && lng === 0) return null
  return [lat, lng]
}

export type VulnerabilityFilter = 'all' | 'moderate-high' | 'high'

/** Each mapped resident weighted by VPI score ÷ maximum score. Zero-score residents add nothing. */
export function vulnerabilityPoints(residents: Resident[], filter: VulnerabilityFilter = 'all', asOf = vpiToday()) {
  const points: HeatPoint[] = []
  let unmapped = 0
  let incomplete = 0
  for (const r of residents) {
    const pos = residentPosition(r)
    if (!pos) { unmapped++; continue }
    const vpi = calculateVpi(r, DEFAULT_VPI_RULES, asOf)
    if (vpi.level === 'Incomplete') incomplete++
    if (filter === 'high' && vpi.score < DEFAULT_VPI_RULES.highAt) continue
    if (filter === 'moderate-high' && vpi.score < DEFAULT_VPI_RULES.moderateAt) continue
    if (vpi.score <= 0) continue
    points.push({ lat: pos[0], lng: pos[1], weight: Math.min(1, vpi.score / vpi.maxScore), kind: 'vulnerability' })
  }
  return { points, unmapped, incomplete }
}

function withinWindow(iso: string | null, windowHours: number | null, now: number) {
  if (windowHours === null) return true
  if (!iso) return false
  const t = Date.parse(iso)
  return Number.isFinite(t) && t <= now + 60_000 && now - t <= windowHours * 3_600_000
}

/**
 * Incident points. Evacuation outcomes and SOS alerts are filtered by the time window;
 * open missing reports and active disaster events are current state and always included.
 * Resident-linked incidents are plotted at the resident's registered home location.
 */
export function incidentPoints(residents: Resident[], inputs: IncidentInputs, windowHours: number | null, now = Date.now()) {
  const positions = new Map<string, [number, number]>()
  for (const r of residents) {
    const pos = residentPosition(r)
    if (pos) positions.set(String(r.id), pos)
  }
  const points: HeatPoint[] = []
  let unmapped = 0
  const add = (uid: string | null, weight: number, kind: keyof typeof INCIDENT_WEIGHTS) => {
    const pos = uid ? positions.get(uid) : undefined
    if (!pos) { unmapped++; return }
    points.push({ lat: pos[0], lng: pos[1], weight, kind })
  }
  for (const s of inputs.latestStatus) {
    if (!withinWindow(s.loggedAt, windowHours, now)) continue
    if (s.status === 'failed') add(s.uid, INCIDENT_WEIGHTS.failedRescue, 'failedRescue')
    else if (s.status === 'pending') add(s.uid, INCIDENT_WEIGHTS.pending, 'pending')
    else if (s.status === 'in_transit') add(s.uid, INCIDENT_WEIGHTS.inTransit, 'inTransit')
  }
  for (const r of inputs.openReports) add(r.residentUid, INCIDENT_WEIGHTS.missingReport, 'missingReport')
  for (const a of inputs.sosAlerts) {
    if ((a.status ?? 'active') !== 'active' || !withinWindow(a.createdAt, windowHours, now)) continue
    const level = Number.isFinite(a.level) ? Math.max(1, Math.min(3, a.level)) : 1
    add(a.residentUid, INCIDENT_WEIGHTS.sos * (0.6 + 0.2 * (level - 1)), 'sos')
  }
  for (const e of inputs.events) {
    if (e.status !== 'active' || e.lat === null || e.lng === null) continue
    points.push({ lat: Number(e.lat), lng: Number(e.lng), weight: INCIDENT_WEIGHTS.disasterEvent, kind: 'disasterEvent' })
  }
  return { points, unmapped }
}

export type GridCell = {
  key: string
  south: number
  west: number
  north: number
  east: number
  count: number
  weight: number
  /** weight ÷ heaviest cell, 0–1. */
  intensity: number
  kinds: Record<string, number>
}

/** Bins points into square cells of roughly `cellMeters` on a side. */
export function gridCells(points: HeatPoint[], cellMeters = 250): GridCell[] {
  if (!points.length) return []
  const meanLat = points.reduce((s, p) => s + p.lat, 0) / points.length
  const dLat = cellMeters / 111_320
  const dLng = cellMeters / (111_320 * Math.max(0.01, Math.cos(meanLat * Math.PI / 180)))
  const cells = new Map<string, GridCell>()
  for (const p of points) {
    const i = Math.floor(p.lat / dLat)
    const j = Math.floor(p.lng / dLng)
    const key = `${i}:${j}`
    let c = cells.get(key)
    if (!c) {
      c = { key, south: i * dLat, north: (i + 1) * dLat, west: j * dLng, east: (j + 1) * dLng, count: 0, weight: 0, intensity: 0, kinds: {} }
      cells.set(key, c)
    }
    c.count++
    c.weight += p.weight
    c.kinds[p.kind] = (c.kinds[p.kind] ?? 0) + 1
  }
  const list = [...cells.values()]
  const max = Math.max(...list.map(c => c.weight))
  for (const c of list) c.intensity = max > 0 ? c.weight / max : 0
  return list.sort((a, b) => a.weight - b.weight)
}

/** Single-hue sequential ramps (light → dark). Violet for vulnerability, orange for incidents. */
export const HEAT_RAMPS: Record<HeatLayerKind, string[]> = {
  vulnerability: ['#e4e0fa', '#b9b0f0', '#8f81e3', '#6250d6', '#4535b0', '#2e2370'],
  incidents: ['#fde3d6', '#f8b597', '#f28a5f', '#eb6834', '#b9471a', '#7a260a'],
}

export function rampColor(kind: HeatLayerKind, t: number) {
  const ramp = HEAT_RAMPS[kind]
  const i = Math.min(ramp.length - 1, Math.max(0, Math.round(t * (ramp.length - 1))))
  return ramp[i]
}

/** Meters per screen pixel at a latitude and Leaflet zoom level. */
export function metersPerPixel(lat: number, zoom: number) {
  return 40_075_016.686 * Math.cos(lat * Math.PI / 180) / 2 ** (zoom + 8)
}

export type CirclePoint = {
  key: string
  lat: number
  lng: number
  count: number
  weight: number
  /** weight ÷ heaviest circle, 0–1. */
  intensity: number
  kinds: Record<string, number>
}

/** Merges points at the same location (e.g. a failed rescue and a missing report for one home). */
export function mergePoints(points: HeatPoint[]): CirclePoint[] {
  const map = new Map<string, CirclePoint>()
  for (const p of points) {
    const key = `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`
    let c = map.get(key)
    if (!c) { c = { key, lat: p.lat, lng: p.lng, count: 0, weight: 0, intensity: 0, kinds: {} }; map.set(key, c) }
    c.count++
    c.weight += p.weight
    c.kinds[p.kind] = (c.kinds[p.kind] ?? 0) + 1
  }
  const list = [...map.values()]
  const max = Math.max(0, ...list.map(c => c.weight))
  for (const c of list) c.intensity = max > 0 ? c.weight / max : 0
  // Lightest first so the most intense circles draw on top.
  return list.sort((a, b) => a.weight - b.weight)
}
