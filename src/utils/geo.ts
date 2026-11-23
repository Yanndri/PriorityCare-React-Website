// Straight-line distance in km between two [lat, lng] points (haversine formula).
export function haversineKm(a: [number, number], b: [number, number]) {
  const r = (d: number) => d * Math.PI / 180
  const h = Math.sin(r(b[0] - a[0]) / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(r(b[1] - a[1]) / 2) ** 2
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)))
}
