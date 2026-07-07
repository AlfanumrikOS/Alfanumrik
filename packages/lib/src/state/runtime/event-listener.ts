/**
 * src/lib/state/runtime/event-listener.ts — legacy tick/run API surface.
 *
 * DEPRECATED — adapter layer over the per-subscriber substrate.
 *
 * The historical implementation here used a SINGLE global cursor stored
 * in `bus_cursor` (key `state_events_watermark`) and strict per-event
 * ordering: one failing subscriber would block every event after it. That
 * substrate has been superseded by the per-subscriber pipeline rooted at
 * `tick-all.ts` / `tick-one.ts`, which tracks an independent cursor per
 * subscriber in `subscriber_offsets` and dead-letters poison-pill events
 * after `subscriber.maxRetries` failures. The new substrate is the
 * canonical path; the canonical driver is the projector-runner Edge
 * Function (see `supabase/functions/projector-runner`).
 *
 * This file is preserved as a thin compatibility shim so existing callers
 * — primarily `scripts/run-event-listener.ts` (the standalone worker used
 * for local dev / staging-backstop) — keep working while the rollout
 * stabilises. The compatibility surface is:
 *
 *   - `tick(opts) → TickResult` still returns the same shape, but
 *     internally it builds a SubscriberContext and delegates to
 *     `tickAll`. The returned `fetched` / `dispatched` totals are summed
 *     across all subscribers; `outcomes` is synthesised one-per-subscriber
 *     (the legacy per-event granularity is gone — the new substrate
 *     doesn't track that, and no production caller reads it).
 *   - `run(opts)` is still a long-running loop with the same interval +
 *     backoff semantics, and each iteration goes through the adapted
 *     `tick`.
 *   - `bus_cursor` writes are best-effort. After each delegated tick we
 *     take the MIN of `subscriber_offsets.last_processed_occurred_at`
 *     and upsert it into `bus_cursor` so anything still reading the
 *     legacy cursor sees a moving watermark. A failure to write the
 *     legacy cursor must NOT affect the returned `TickResult` — the new
 *     path is authoritative.
 *   - `defaultCursor` / `CursorStore` remain exported for backwards
 *     compatibility but the READ side is no longer consulted (the new
 *     path reads `subscriber_offsets` per subscriber). Tests that injected
 *     a custom `cursor` will still see `cursor.write` called via the
 *     best-effort backstop path, but `cursor.read` is now a no-op.
 *
 * Removal plan: one week after the projector-runner kill-switch
 * (`ff_projector_runner_v1`) is at 100% rollout in production, this file
 * and the `bus_cursor` table are deleted in a follow-up PR. The
 * standalone script either gets repointed at `tickAll` directly or is
 * retired in favour of the Edge Function driver.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { DomainEvent } from '../events/registry';
import {
  type Dispatcher,
  type DispatchOutcome,
  type SubscriberContext,
  defaultLog,
  standardDispatcher,
} from '../subscribers/dispatcher';
import { tickAll } from './tick-all';

const CURSOR_KEY = 'state_events_watermark';
const EPOCH = '1970-01-01T00:00:00Z';

export interface ListenerOptions {
  sb: SupabaseClient;
  dispatcher?: Dispatcher;
  /** Max events fetched per tick. Default 100. */
  batchSize?: number;
  /** When the subscriber should run as a no-op (parity check). */
  dryRun?: boolean;
  /** Injected clock for tests. */
  now?: () => Date;
  /** Structured logger callback. Defaults to console.info. */
  log?: SubscriberContext['log'];
  /** Custom cursor read/write hooks (for tests). */
  cursor?: CursorStore;
}

export interface CursorStore {
  read(sb: SupabaseClient): Promise<string>;
  write(sb: SupabaseClient, newCursor: string): Promise<void>;
}

export interface TickResult {
  fetched: number;
  dispatched: number;
  outcomes: Array<{
    eventId: string;
    kind: DomainEvent['kind'];
    subscribers: DispatchOutcome[];
    advanced: boolean;
  }>;
  newCursor: string;
}

/**
 * Legacy bus_cursor accessor. Retained as an export so any direct callers
 * compile, but the read side is no longer used by `tick()` — the new
 * substrate reads `subscriber_offsets` per subscriber. The write side is
 * still invoked via the best-effort backstop in `tick()` so consumers of
 * the legacy cursor see a moving watermark during the transition window.
 */
export const defaultCursor: CursorStore = {
  async read(sb) {
    const { data, error } = await sb
      .from('bus_cursor')
      .select('cursor_value')
      .eq('cursor_key', CURSOR_KEY)
      .maybeSingle();
    if (error) return EPOCH;
    return data?.cursor_value ?? EPOCH;
  },
  async write(sb, newCursor) {
    await sb
      .from('bus_cursor')
      .upsert(
        { cursor_key: CURSOR_KEY, cursor_value: newCursor },
        { onConflict: 'cursor_key' },
      );
  },
};

/**
 * One pass over the bus. Now delegates to `tickAll` for the actual work
 * and adapts the result back to the legacy `TickResult` shape.
 *
 * Semantics that changed vs. the old implementation:
 *   - Each subscriber advances its own cursor. There is no longer a
 *     single global watermark. `newCursor` in the returned `TickResult`
 *     is the MIN of all subscribers' watermarks (i.e. the slowest
 *     subscriber) — that's also what gets written to the legacy
 *     `bus_cursor` table.
 *   - `outcomes` is no longer one entry per event. It's one synthetic
 *     entry per subscriber, summarising the tick. The shape is
 *     preserved for back-compat; the standalone script only reads
 *     `fetched` / `dispatched` / `newCursor`.
 *   - Skipped ticks (kill-switch OFF, flag read failure) return a
 *     `TickResult` with zero counters and `newCursor` set to whatever
 *     the legacy `bus_cursor` already held (i.e. unchanged). No write
 *     to the legacy cursor happens on skip.
 */
export async function tick(opts: ListenerOptions): Promise<TickResult> {
  const sb = opts.sb;
  const dispatcher = opts.dispatcher ?? standardDispatcher;
  const batchSize = opts.batchSize ?? 100;
  const dryRun = opts.dryRun ?? false;
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? defaultLog;
  const cursor = opts.cursor ?? defaultCursor;

  const ctx: SubscriberContext = { sb, dryRun, now, log };

  const result = await tickAll({ sb, ctx, dispatcher, batchSize });

  if (result.skipped) {
    // Kill-switch OFF or fail-closed — no cursors moved. Report a quiet
    // tick. We do NOT read the legacy bus_cursor here either; the value
    // doesn't matter to the standalone script when fetched=0.
    return {
      fetched: 0,
      dispatched: 0,
      outcomes: [],
      newCursor: EPOCH,
    };
  }

  // Sum counters across subscribers.
  let fetched = 0;
  let dispatched = 0;
  const outcomes: TickResult['outcomes'] = [];
  for (const sub of result.perSubscriber) {
    fetched += sub.processed + sub.deadLettered;
    dispatched += sub.processed;
    // One synthetic outcome per subscriber. The new substrate doesn't
    // track per-event outcomes the way the old per-event dispatcher did;
    // we emit a single summary line per subscriber so the field stays
    // populated for any legacy reader. `eventId` is the subscriber name
    // (there is no single event to point at), and `advanced` is true if
    // the subscriber processed >0 events without a stuck retry.
    outcomes.push({
      eventId: `subscriber:${sub.subscriberName}`,
      kind: 'mesh.cycle_completed', // placeholder — the field is non-load-bearing
      subscribers: [
        {
          subscriber: sub.subscriberName,
          status: sub.processed > 0 || sub.deadLettered > 0 ? 'ok' : 'skipped',
          message: `processed=${sub.processed} deadLettered=${sub.deadLettered}`,
        },
      ],
      advanced: sub.processed > 0,
    });
  }

  // Best-effort legacy bus_cursor advance. Take the MIN of all
  // subscribers' last_processed_occurred_at so any consumer still reading
  // the legacy watermark sees the slowest-subscriber position (the only
  // safe interpretation of a global cursor across heterogenous lag).
  // Failure here MUST NOT affect the returned TickResult.
  let newCursor = EPOCH;
  try {
    const { data: offsetRows } = await sb
      .from('subscriber_offsets')
      .select('last_processed_occurred_at');
    const watermarks = (offsetRows ?? [])
      .map(r => (r as { last_processed_occurred_at?: string | null }).last_processed_occurred_at)
      .filter((v): v is string => typeof v === 'string' && v.length > 0);
    if (watermarks.length > 0) {
      newCursor = watermarks.reduce((min, w) => (w < min ? w : min));
      await cursor.write(sb, newCursor);
    }
  } catch {
    // Swallow — the new path is authoritative. The legacy cursor is a
    // best-effort backstop; a failure here is not a tick failure.
  }

  return { fetched, dispatched, outcomes, newCursor };
}

/** Long-running loop. Used by scripts/run-event-listener.ts. */
export async function run(opts: ListenerOptions & { intervalMs?: number; signal?: AbortSignal }) {
  const interval = opts.intervalMs ?? 1000;
  for (;;) {
    if (opts.signal?.aborted) return;
    try {
      const result = await tick(opts);
      if (result.fetched > 0) {
        // eslint-disable-next-line no-console
        console.info(`[event-listener] tick processed=${result.dispatched}/${result.fetched} cursor=${result.newCursor}`);
      }
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.error(`[event-listener] tick failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    await sleep(interval, opts.signal);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
}
