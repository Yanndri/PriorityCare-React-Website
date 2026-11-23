import { createContext, useContext } from 'react'

// "See on map" buttons open the web Map page centered on a spot, instead of
// sending staff to an outside map site. App.tsx provides the function.
export type MapPin = { lat: number; lng: number; label: string }
export const ShowOnMapContext = createContext<((pin: MapPin) => void) | null>(null)
export const useShowOnMap = () => useContext(ShowOnMapContext)
