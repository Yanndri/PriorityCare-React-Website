import { useEffect, useMemo, useState } from 'react'
import { GeoJSON } from 'react-leaflet'
import type { Feature, FeatureCollection, Geometry, Position } from 'geojson'
import type { Layer, PathOptions } from 'leaflet'

// Outlines of Cordova's 13 barangays, the same boundaries the mobile app uses
// (simplified copy in public/cordova-barangays.json, loaded once on demand).

type Props = {
  /** A point inside the barangay to highlight, e.g. the admin's barangay centre. */
  highlightAt?: [number, number] | null
}

type Barangays = FeatureCollection<Geometry, { name: string }>
let cache: Promise<Barangays> | null = null

function loadBarangays(): Promise<Barangays> {
  cache ??= fetch(`${import.meta.env.BASE_URL}cordova-barangays.json`)
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<Barangays> })
    .catch(e => { cache = null; throw e })
  return cache
}

function inRing([lat, lng]: [number, number], ring: Position[]) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function contains(feature: Feature<Geometry>, point: [number, number]) {
  const g = feature.geometry
  const polygons = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []
  return polygons.some(rings => inRing(point, rings[0]) && !rings.slice(1).some(hole => inRing(point, hole)))
}

const BORDER: PathOptions = { color: '#475569', weight: 1.5, opacity: 0.8, dashArray: '5 5', fillColor: '#64748b', fillOpacity: 0.03 }
const HIGHLIGHT: PathOptions = { color: '#DC2626', weight: 2.5, opacity: 1, dashArray: undefined, fillColor: '#EF4444', fillOpacity: 0.08 }

export function BarangayBordersLayer({ highlightAt = null }: Props) {
  const [data, setData] = useState<Barangays | null>(null)
  useEffect(() => {
    let active = true
    loadBarangays().then(d => { if (active) setData(d) }).catch(() => undefined)
    return () => { active = false }
  }, [])

  const highlighted = useMemo(() => {
    if (!data || !highlightAt) return null
    return data.features.find(f => contains(f, highlightAt))?.properties.name ?? null
  }, [data, highlightAt])

  if (!data) return null
  return (
    <GeoJSON
      key={highlighted ?? 'none'}
      data={data}
      style={f => (f?.properties?.name === highlighted ? HIGHLIGHT : BORDER)}
      onEachFeature={(f: Feature<Geometry, { name: string }>, layer: Layer) => {
        layer.bindTooltip(f.properties.name, { sticky: true, className: 'barangay-tooltip', direction: 'top' })
      }}
    />
  )
}
