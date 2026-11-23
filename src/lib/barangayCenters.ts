
// Where maps open (Cordova town center) and how far they can be moved.

export const CORDOVA_CENTER: [number, number] = [10.2526, 123.9496]
export const BARANGAY_ZOOM = 15
export const MUNICIPAL_ZOOM = 14

// Every map opens on all of Cordova (user decision 2026-11-14). The barangay
// argument is kept so callers do not change; zoom into a barangay by
// clicking its border on the Map page instead.
export function useBarangayView(barangayId?: number | null): { center: [number, number]; zoom: number } {
  void barangayId
  return { center: CORDOVA_CENTER, zoom: MUNICIPAL_ZOOM }
}

// Cordova's outline (from the barangay borders) plus a small margin. Maps
// cannot be panned or zoomed out past it, so only Cordova tiles load.
export const CORDOVA_BOUNDS: [[number, number], [number, number]] = [[10.175, 123.895], [10.295, 124.02]]
// Viscosity below 1 lets the edge give a little instead of snapping back hard while zooming.
export const CORDOVA_MAP_LIMITS = { maxBounds: CORDOVA_BOUNDS, maxBoundsViscosity: 0.85, minZoom: 13 }

// Rough check used until the exact borders have loaded.
export const inCordovaBox = (lat: number, lng: number) =>
  lat >= CORDOVA_BOUNDS[0][0] && lat <= CORDOVA_BOUNDS[1][0] && lng >= CORDOVA_BOUNDS[0][1] && lng <= CORDOVA_BOUNDS[1][1]
