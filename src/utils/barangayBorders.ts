import { useEffect, useState } from 'react'
import { inCordovaBox } from '../lib/barangayCenters'

// Barangay borders of Cordova (the same cadastral file the app uses, in
// public/cordova-barangays.json) and a point-in-polygon test, so the map
// can show only what falls inside one barangay.

type Ring = [number, number][] // [lng, lat] pairs, as in GeoJSON
type Geometry =
  | { type: 'Polygon'; coordinates: Ring[] }
  | { type: 'MultiPolygon'; coordinates: Ring[][] }

export type BarangayBorder = {
  type: 'Feature'
  properties: { name: string }
  geometry: Geometry
}

let cache: Promise<BarangayBorder[]> | null = null

function loadBorders(): Promise<BarangayBorder[]> {
  cache ??= fetch(`${import.meta.env.BASE_URL}cordova-barangays.json`)
    .then((r) => {
      if (!r.ok) throw new Error('Could not load barangay borders.')
      return r.json()
    })
    .then((d: { features: BarangayBorder[] }) => d.features)
    .catch((e) => { cache = null; throw e })
  return cache
}

export function useBarangayBorders(): BarangayBorder[] {
  const [borders, setBorders] = useState<BarangayBorder[]>([])
  useEffect(() => {
    let cancelled = false
    loadBorders().then((b) => { if (!cancelled) setBorders(b) }).catch(() => { /* map works without borders */ })
    return () => { cancelled = true }
  }, [])
  return borders
}

export const sameName = (a?: string | null, b?: string | null) =>
  Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase())

// Ray casting: count how many edges a line going right from the point crosses.
// Odd = inside.
function insideRing(lat: number, lng: number, ring: Ring): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

// First ring is the outline; any later rings are holes.
function insidePolygon(lat: number, lng: number, rings: Ring[]): boolean {
  if (!rings.length || !insideRing(lat, lng, rings[0])) return false
  return !rings.slice(1).some((hole) => insideRing(lat, lng, hole))
}

export function isInsideBarangay(lat: number, lng: number, border: BarangayBorder): boolean {
  const g = border.geometry
  return g.type === 'Polygon'
    ? insidePolygon(lat, lng, g.coordinates)
    : g.coordinates.some((poly) => insidePolygon(lat, lng, poly))
}

// Inside any Cordova barangay. Before the borders load, a rough box is used.
export function isInCordova(lat: number, lng: number, borders: BarangayBorder[]): boolean {
  return borders.length ? borders.some((b) => isInsideBarangay(lat, lng, b)) : inCordovaBox(lat, lng)
}

export const OUTSIDE_CORDOVA = 'That spot is outside Cordova. Pick a place inside the municipality.'
