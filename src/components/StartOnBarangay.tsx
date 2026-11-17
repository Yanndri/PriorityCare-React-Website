import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
import * as L from 'leaflet'
import { sameName, useBarangayBorders } from '../utils/barangayBorders'

// Opens the map zoomed on one barangay (an admin's own), using its border from
// public/cordova-barangays.json. The border is not drawn. Runs once, so the
// admin can still pan around afterwards.
export function StartOnBarangay({ name }: { name: string | null }) {
  const map = useMap()
  const borders = useBarangayBorders()
  const done = useRef(false)
  useEffect(() => {
    if (done.current || !name) return
    const border = borders.find((b) => sameName(b.properties.name, name))
    if (!border) return
    done.current = true
    map.fitBounds(L.geoJSON(border as GeoJSON.Feature).getBounds(), { padding: [24, 24] })
  }, [name, borders, map])
  return null
}
