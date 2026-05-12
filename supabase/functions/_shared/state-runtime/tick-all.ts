/**
 * supabase/functions/_shared/state-runtime/tick-all.ts
 *
 * Deno-side copy of `src/lib/state/runtime/tick-all.ts`.
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { Dispatcher } from './dispatcher.ts'
import type { SubscriberContext } from './subscriber.ts'
import { tickOne, type TickOneResult } from './tick-one.ts'
import { isProjectorRunnerEnabled } from './flag.ts'

export interface TickAllOptions {
  sb: SupabaseClient
  ctx: SubscriberContext
  dispatcher: Dispatcher
  batchSize?: number
}

export interface TickAllResult {
  skipped: boolean
  perSubscriber: TickOneResult[]
  failedClosedReason?: string
}

export async function tickAll(opts: TickAllOptions): Promise<TickAllResult> {
  let enabled: boolean
  try {
    enabled = await isProjectorRunnerEnabled(opts.sb)
  } catch (err) {
    return {
      skipped: true,
      perSubscriber: [],
      failedClosedReason: `flag read failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
  if (!enabled) {
    return { skipped: true, perSubscriber: [] }
  }
  const perSubscriber: TickOneResult[] = []
  for (const sub of opts.dispatcher.list()) {
    const r = await tickOne(sub, {
      sb: opts.sb,
      ctx: opts.ctx,
      batchSize: opts.batchSize,
    })
    perSubscriber.push(r)
  }
  return { skipped: false, perSubscriber }
}
