import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'

export function useRealtimeSubscription(
  table: string,
  filter: string | null,
  onInsert?: (payload: Record<string, unknown>) => void,
  onUpdate?: (payload: Record<string, unknown>) => void,
  onDelete?: (payload: Record<string, unknown>) => void,
  enabled: boolean = true
) {
  useEffect(() => {
    if (!enabled || !supabase) return

    let channel: RealtimeChannel
    const channelName = `${table}-${filter || 'all'}-${Date.now()}`

    const subscription = supabase.channel(channelName)
    const config: Record<string, string> = { event: '*', schema: 'public', table }
    if (filter) config.filter = filter

    channel = subscription
      // @ts-expect-error -- Supabase channel overload types don't accept dynamic config
      .on('postgres_changes', config, (payload: Record<string, unknown>) => {
        if (payload.eventType === 'INSERT' && onInsert) onInsert(payload)
        if (payload.eventType === 'UPDATE' && onUpdate) onUpdate(payload)
        if (payload.eventType === 'DELETE' && onDelete) onDelete(payload)
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [table, filter, enabled])
}
