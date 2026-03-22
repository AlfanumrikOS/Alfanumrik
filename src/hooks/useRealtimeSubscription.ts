import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'

export function useRealtimeSubscription(
  table: string,
  filter: string | null,
  onInsert?: (payload: any) => void,
  onUpdate?: (payload: any) => void,
  onDelete?: (payload: any) => void,
  enabled: boolean = true
) {
  useEffect(() => {
    if (!enabled || !supabase) return

    let channel: RealtimeChannel
    const channelName = `${table}-${filter || 'all'}-${Date.now()}`

    const subscription = supabase.channel(channelName)

    let config: any = { event: '*', schema: 'public', table }
    if (filter) config.filter = filter

    channel = subscription
      .on('postgres_changes', config, (payload) => {
        if (payload.eventType === 'INSERT' && onInsert) onInsert(payload)
        if (payload.eventType === 'UPDATE' && onUpdate) onUpdate(payload)
        if (payload.eventType === 'DELETE' && onDelete) onDelete(payload)
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [table, filter, enabled])
}
