import type { SupabaseClient } from '@supabase/supabase-js';
import type { Dispatcher } from '@alfanumrik/lib/state/subscribers/dispatcher';
import type { SubscriberContext } from '@alfanumrik/lib/state/subscribers/subscriber';
import { tickOne, type TickOneResult } from './tick-one';
import { isProjectorRunnerEnabled } from './flag';

export interface TickAllOptions {
  sb: SupabaseClient;
  ctx: SubscriberContext;
  dispatcher: Dispatcher;
  batchSize?: number;
}

export interface TickAllResult {
  skipped: boolean;
  perSubscriber: TickOneResult[];
  /** Set when skipped because the flag check or runner reading threw. */
  failedClosedReason?: string;
}

/**
 * Run every registered subscriber once. The kill-switch flag is checked
 * once per invocation; if it's OFF (or its read throws — fail closed),
 * tickAll returns immediately with { skipped: true } and no cursors move.
 *
 * Each subscriber's tickOne is independent: one subscriber's failure
 * doesn't prevent another from advancing. Errors from individual
 * subscribers are absorbed into TickOneResult; only catastrophic errors
 * (DB outage on the flag read, dispatcher.list() throwing) bubble.
 */
export async function tickAll(opts: TickAllOptions): Promise<TickAllResult> {
  let enabled: boolean;
  try {
    enabled = await isProjectorRunnerEnabled(opts.sb);
  } catch (err) {
    // Fail closed: if we can't read the flag, treat as OFF. The runner
    // must NEVER advance cursors when its kill-switch state is unknown.
    return {
      skipped: true,
      perSubscriber: [],
      failedClosedReason: `flag read failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!enabled) {
    return { skipped: true, perSubscriber: [] };
  }
  const perSubscriber: TickOneResult[] = [];
  for (const sub of opts.dispatcher.list()) {
    const r = await tickOne(sub, {
      sb: opts.sb, ctx: opts.ctx, batchSize: opts.batchSize,
    });
    perSubscriber.push(r);
  }
  return { skipped: false, perSubscriber };
}
