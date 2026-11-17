import { createContext, useContext } from 'react'

// The barangay the page should show: an Admin's own barangay, or the one a Super Admin
// picked in the Scope selector. null = all barangays (Super Admin "All barangays").
export const ScopeContext = createContext<number | null>(null)
export const useScopeBarangay = () => useContext(ScopeContext)
// Keeps rows of the scoped barangay (every row when the scope is all barangays).
export const inScope = (scope: number | null, barangayId: number | null | undefined) =>
  scope == null || barangayId === scope
