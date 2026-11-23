import { useEffect, useRef } from 'react'
import { hasSupabaseConfig, supabase } from './supabaseClient'

// Topics bumped by the database (migration 20261102_01_live_signals) whenever a table changes:
// events, centers, shelter_plans, sos, tickets, units, evacuation, hazards, missing, preemptive,
// residents, accounts. The signal only says *that* something changed; the page reloads through its
// own scoped queries, so no row data travels over the live channel.
export type LiveTopic =
  | 'events' | 'centers' | 'shelter_plans' | 'sos' | 'tickets' | 'units' | 'evacuation'
  | 'hazards' | 'missing' | 'preemptive' | 'residents' | 'accounts'

let channelSeq = 0

// Calls onChange (debounced) when any of the topics changes, e.g. an SOS from the app or a rescuer
// moving a ticket. Pass the page's own load function; the latest one is always used.
export function useLiveSignal(topics: LiveTopic[], onChange: (topic: LiveTopic) => void, enabled = true) {
  const handler = useRef(onChange)
  useEffect(() => {
    handler.current = onChange
  })
  const key = topics.join(',')

  useEffect(() => {
    if (!enabled || !hasSupabaseConfig) return
    const wanted = new Set(key.split(','))
    let timer: ReturnType<typeof setTimeout> | undefined
    let lastTopic: LiveTopic | null = null
    const channel = supabase
      .channel(`pc-live-${key}-${++channelSeq}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'live_signals' }, (payload) => {
        const topic = (payload.new as { topic?: string } | null)?.topic
        if (!topic || !wanted.has(topic)) return
        lastTopic = topic as LiveTopic
        clearTimeout(timer)
        timer = setTimeout(() => { if (lastTopic) handler.current(lastTopic) }, 500)
      })
      .subscribe()
    return () => {
      clearTimeout(timer)
      void supabase.removeChannel(channel)
    }
  }, [key, enabled])
}
