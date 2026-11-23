import { useEffect, useState } from 'react'
import { getEventRegister, type DisasterEvent } from '../api/disasterEventsApi'
import { getHazardReports } from '../api/hazardReportsApi'
import { useLiveSignal } from './useLiveSignal'

// What the whole dashboard needs to know about the operation, for the red bar
// and the sidebar counts: the disasters declared right now, and how many
// hazard reports still wait for a Yes or No.
export type OperationStatus = {
  active: (DisasterEvent & { barangay_name: string })[]
  waitingAlarms: number
}

// scopeBarangayId: null = every barangay (super admin "All barangays").
export function useOperationStatus(scopeBarangayId: number | null): OperationStatus {
  const [status, setStatus] = useState<OperationStatus>({ active: [], waitingAlarms: 0 })
  const [tick, setTick] = useState(0)
  useLiveSignal(['events', 'hazards'], () => setTick((n) => n + 1))

  useEffect(() => {
    let cancelled = false
    const inScope = (id: number | null) => scopeBarangayId === null || id === scopeBarangayId
    void Promise.allSettled([getEventRegister(), getHazardReports()]).then(([register, hazards]) => {
      if (cancelled) return
      const names = new Map(register.status === 'fulfilled' ? register.value.barangays.map((b) => [b.barangay_id, b.barangay_name]) : [])
      setStatus({
        active: register.status === 'fulfilled'
          ? register.value.events
            .filter((e) => e.status === 'active' && inScope(e.barangay_id))
            .map((e) => ({ ...e, barangay_name: names.get(e.barangay_id) ?? '' }))
          : [],
        waitingAlarms: hazards.status === 'fulfilled'
          ? hazards.value.filter((h) => (h.status === 'unverified' || h.status === 'under_review') && inScope(h.barangay_id)).length
          : 0,
      })
    })
    return () => { cancelled = true }
  }, [scopeBarangayId, tick])

  return status
}

