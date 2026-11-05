import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

// Where maps open: the barangay's centre point (barangays.center_lat/lng), or
// Cordova town centre when no single barangay is chosen.

export const CORDOVA_CENTER: [number, number] = [10.2526, 123.9496]
export const BARANGAY_ZOOM = 15
export const MUNICIPAL_ZOOM = 14

type Centers = Map<number, [number, number]>
let cache: Promise<Centers> | null = null

function loadCenters(): Promise<Centers> {
  cache ??= Promise.resolve(supabase.from('barangays').select('barangay_id, center_lat, center_lng')).then(({ data, error }) => {
    if (error) throw error
    const map: Centers = new Map()
    for (const row of data ?? []) {
      if (row.center_lat != null && row.center_lng != null) map.set(row.barangay_id, [Number(row.center_lat), Number(row.center_lng)])
    }
    return map
  }).catch((e) => { cache = null; throw e })
  return cache
}

// [centre, zoom] for a barangay, or for all of Cordova when barangayId is null.
export function useBarangayView(barangayId: number | null | undefined): { center: [number, number]; zoom: number } {
  const [centers, setCenters] = useState<Centers | null>(null)
  useEffect(() => {
    let cancelled = false
    loadCenters().then((c) => { if (!cancelled) setCenters(c) }).catch(() => { /* fall back to Cordova */ })
    return () => { cancelled = true }
  }, [])
  const point = barangayId != null ? centers?.get(barangayId) : undefined
  return point ? { center: point, zoom: BARANGAY_ZOOM } : { center: CORDOVA_CENTER, zoom: MUNICIPAL_ZOOM }
}
