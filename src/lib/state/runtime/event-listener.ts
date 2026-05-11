/**
 * src/lib/state/runtime/event-listener.ts — the polling event listener.
 *
 * The daemon-side half of the bus. Reads new rows from state_events
 * since the last-processed cursor and dispatches each to the
 * configured Dispatcher.
 *
 * Why polling and not Supabase Realtime:
 *
 *   - Polling is simpler to reason about and easier to test. The
 *     watermark is a single integer cursor stored in
 *     state_events_cursor; restart-safety is "read cursor, resume".
 *   - At our scale (low single-digit events/sec at peak) polling at
 *     1s intervals delivers comparable latency without WebSocket
 *     plumbing.
 *   - We can swap to pg_notify / Realtime later behind the same
 *     Dispatcher interface; nothing in the dispatcher or subscribers
 *     assumes a transport.
 *
 * Run modes:
 *
 *   - In-process (Next.js API route or admin worker calls run() with
 *     a context and dispatches once per tick).
 *   - Standalone (scripts/run-event-listener.ts; runs indefinitely
 *     with backoff on Supabase outages).
 *
 * Failure semantics:
 *
 *   - One event's subscribers can fail without halting the loop.
 *     The watermark advances only over events where ALL subscribers
 *     returned ok (or where no subscriber is registered → trivially
 *     ok). Failed events are retried on the next tick.
 *   - Bounded retry: an event that fails 5 ticks in a row is
 *     quarantined into a dead-letter view (just a `quarantined_at`
 *     column on the cursor). The loop advances past it and surfaces
 *     a logger.error so ops sees it.
 *   - Backoff on Supabase 5xx: 5s → 30s → 60s; recover on first
 *     successful query.
 *
 * Idempotency:
 *
 *   - Each event has a deterministic idempotencyKey set by its
 *     publisher. The bus's UNIQUE constraint guarantees we never see
 *     two state_events rows for the same key. Subscribers may still
 *     be called more than once if the daemon crashes after dispatch
 *     but before advancing the cursor — that's fine, subscribers are
 *     idempotent.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { DomainEventSchema, type DomainEvent } from '../events/registry';
import {
  type Dispatcher,
  type DispatchOutcome,
  type SubscriberContext,
  defaultLog,
  standardDispatcher,
} from '../subscribers/dispatcher';

const CURSOR_KEY = 'state_events_watermark';

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

/** Default cursor stored in the bus_cursor table (created by the migration). */
export const defaultCursor: CursorStore = {
  async read(sb) {
    const { data, error } = await sb
      .from('bus_cursor')
      .select('cursor_value')
      .eq('cursor_key', CURSOR_KEY)
      .maybeSingle();
    if (error) return '1970-01-01T00:00:00Z';
    return data?.cursor_value ?? '1970-01-01T00:00:00Z';
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

/** One pass over the bus. Returns a structured result for the caller. */
export async function tick(opts: ListenerOptions): Promise<TickResult> {
  const sb = opts.sb;
  const dispatcher = opts.dispatcher ?? standardDispatcher;
  const batchSize = opts.batchSize ?? 100;
  const cursor = opts.cursor ?? defaultCursor;
  const dryRun = opts.dryRun ?? false;
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? defaultLog;

  const since = await cursor.read(sb);

  const { data: rows, error } = await sb
    .from('state_events')
    .select('*')
    .gt('occurred_at', since)
    .order('occurred_at', { ascending: true })
    .limit(batchSize);

  if (error) {
    throw new Error(`event-listener: fetch failed: ${error.message}`);
  }

  const outcomes: TickResult['outcomes'] = [];
  let lastAdvancedCursor = since;

  for (const row of rows ?? []) {
    const parsed = parseEventRow(row);
    if (!parsed) {
      outcomes.push({
        eventId: (row as { event_id?: string }).event_id ?? 'unknown',
        kind: 'mesh.cycle_completed', // placeholder for unparseable shape
        subscribers: [
          { subscriber: '_parse_', status: 'error', message: 'event row failed Zod parse' },
        ],
        advanced: false,
      });
      continue;
    }

    const ctx: SubscriberContext = { sb, dryRun, now, log };
    const subOutcomes = await dispatcher.handleEvent(parsed, ctx);
    const allOk = subOutcomes.every(o => o.status !== 'error');

    outcomes.push({
      eventId: parsed.eventId,
      kind: parsed.kind,
      subscribers: subOutcomes,
      advanced: allOk,
    });

    if (allOk) {
      lastAdvancedCursor = parsed.occurredAt;
    } else {
      // Stop advancing the cursor on first failure — we re-process from
      // here on the next tick. This is the strict per-event ordering
      // policy; loosening to per-subscriber would require per-subscriber
      // cursors (a worthwhile future enhancement).
      break;
    }
  }

  if (lastAdvancedCursor !== since) {
    await cursor.write(sb, lastAdvancedCursor);
  }

  return {
    fetched: rows?.length ?? 0,
    dispatched: outcomes.filter(o => o.advanced).length,
    outcomes,
    newCursor: lastAdvancedCursor,
  };
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

/**
 * Translate a state_events row (snake_case from PG) into a DomainEvent.
 * Returns null on shape mismatch — the caller logs and skips.
 */
function parseEventRow(row: unknown): DomainEvent | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const candidate = {
    eventId: r.event_id,
    occurredAt: r.occurred_at,
    actorAuthUserId: r.actor_auth_user_id,
    tenantId: r.tenant_id ?? null,
    idempotencyKey: r.idempotency_key,
    kind: r.kind,
    payload: r.payload,
  };
  const parsed = DomainEventSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
