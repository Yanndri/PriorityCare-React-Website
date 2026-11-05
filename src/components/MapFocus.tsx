import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'

// Moves an open Leaflet map when its focus point changes (a different barangay
// was chosen, or the barangay centres finished loading). The first position is
// left to MapContainer so a saved pin is not overridden on open.
export function MapFocus({ center, zoom }: { center: [number, number]; zoom: number }) {
  const map = useMap()
  const last = useRef<string | null>(null)
  const key = `${center[0]},${center[1]},${zoom}`
  useEffect(() => {
    if (last.current !== null && last.current !== key) map.setView(center, zoom)
    last.current = key
  }, [map, key, center, zoom])
  return null
}
