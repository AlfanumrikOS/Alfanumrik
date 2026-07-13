/**
 * src/lib/state/events/publish.ts — the only function that writes events.
 *
 * Every cross-feature signal in Alfanumrik becomes a row in the
 * `state_events` table via this function. Subscribers (the
 * Orchestrator, the AI context refresher, parent notifications, mesh
 * outcome attribution) read either by polling or by Supabase Realtime
 * channel.
 *
 * Three correctness invariants:
 *
 *   1. **Schema-validated at the edge.** Every payload goes through Zod
 *      before insert. Garbage in is rejected at the publisher, not
 *      discovered at a subscriber three hops later.
 *
 *   2. **Idempotency.** The (eventId, idempotencyKey) pair is UNIQUE in
 *      the DB. Retrying a publish is a no-op; subscribers can rely on
 *      "I've seen this event before? skip."
 *
 *   3. **Flag-gated.** Until `ff_event_bus_v1` is true on the tenant (or
 *      globally for B2C), publish() is a no-op. Callers don't branch on
 *      the flag — they call publish() always; this module enforces the
 *      gate. Lets us roll the bus per tenant without scattered if-checks.
 *
 * What this module does NOT do:
 *   - It does not synchronously call subscribers. Delivery is via
 *     pg_notify + Supabase Realtime, picked up by separate workers.
 *     Publishing latency is one INSERT; subscriber latency is async.
 *   - It does not retry on Supabase outage. The caller decides whether
 *     to enqueue for retry or fail the request that wanted to publish.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { DomainEventSchema, type DomainEvent } from './registry';

const BUS_FLAG_NAME = 'ff_event_bus_v1';

// Module-local cache of the flag value so we don't query feature_flags
// on every publish. TTL is intentionally short — flag flips during a
// rollout should propagate quickly. A null value means "not fetched
// this TTL window".
let cachedFlagAt: number | null = null;
let cachedFlagValue: boolean | null = null;
const FLAG_TTL_MS = 30_000; // 30s

async function isBusEnabled(sb: SupabaseClient): Promise<boolean> {
  const now = Date.now();
  if (cachedFlagValue !== null && cachedFlagAt !== null && now - cachedFlagAt < FLAG_TTL_MS) {
    return cachedFlagValue;
  }
  const { data } = await sb
    .from('feature_flags')
    .select('is_enabled')
    .eq('flag_name', BUS_FLAG_NAME)
    .maybeSingle();
  cachedFlagValue = data?.is_enabled === true;
  cachedFlagAt = now;
  return cachedFlagValue;
}

export interface PublishResult {
  published: boolean;
  reason?: 'flag_off' | 'validation_failed' | 'db_error' | 'duplicate' | 'future_occurred_at';
  errorMessage?: string;
}

/**
 * Max slack we allow between `occurredAt` and ingestion wall-clock. The bus
 * cursor orders by `occurred_at` (see runtime/tick-one.ts), so a row whose
 * occurredAt is far in the FUTURE permanently advances a subscriber's
 * watermark past that date — after which every legitimately now-stamped event
 * is silently skipped (`.gte('occurred_at', cursor)` never matches it) until
 * wall-clock catches up. This was observed in prod (2026-07-13): a poison
 * event stamped occurred_at=2032 pinned `mastery-state-writer`'s watermark to
 * 2032. 24h is generous enough that no legitimate now-stamped caller — even
 * with clock skew or a queued retry — is ever rejected, while egregiously
 * future timestamps (always a bug or a poison pill) are refused at the edge.
 *
 * NOTE: this closes the SANCTIONED path (publishEvent). It does NOT stop a raw
 * service-role INSERT into state_events (how the 2026-07-13 poison arrived).
 * The durable structural fix is to order the bus cursor by the monotonic,
 * server-set `created_at` instead of caller-supplied `occurred_at`; that is an
 * architect-owned follow-up (see docs/runbooks/edge-function-drift-report.md
 * neighbours / the testing-strategy gap-7 writeup).
 */
const MAX_FUTURE_OCCURRED_AT_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Publish a domain event. Single entry point — every feature calls
 * this; nothing else writes state_events directly.
 *
 * Returns synchronously when the INSERT completes (typical: <50ms).
 * Subscribers receive via pg_notify channel `state_events_new` and
 * Supabase Realtime; their handlers are out-of-band.
 *
 * @param sb Service-role Supabase client (the bus is RLS-locked to
 *           service_role; agents never publish from user JWT scope).
 * @param event A DomainEvent matching the registry.
 */
export async function publishEvent(
  sb: SupabaseClient,
  event: DomainEvent,
): Promise<PublishResult> {
  // 1. Validate. We never write something the registry doesn't know.
  const parsed = DomainEventSchema.safeParse(event);
  if (!parsed.success) {
    return {
      published: false,
      reason: 'validation_failed',
      errorMessage: parsed.error.message.slice(0, 500),
    };
  }

  // 1b. Reject far-future occurredAt — poison-watermark guard (see
  //     MAX_FUTURE_OCCURRED_AT_MS). A future-dated event would advance the
  //     ordering cursor past real events and silently skip them.
  const occurredMs = Date.parse(parsed.data.occurredAt);
  if (Number.isFinite(occurredMs) && occurredMs - Date.now() > MAX_FUTURE_OCCURRED_AT_MS) {
    return {
      published: false,
      reason: 'future_occurred_at',
      errorMessage: `occurredAt ${parsed.data.occurredAt} is more than 24h in the future; refused to avoid poisoning the bus watermark`,
    };
  }

  // 2. Flag check. A feature being "wired" to publish is independent of
  //    the bus being live for that tenant; the gate sits here, once.
  if (!(await isBusEnabled(sb))) {
    return { published: false, reason: 'flag_off' };
  }

  // 3. Insert. The UNIQUE constraint on idempotencyKey makes retries safe.
  const e = parsed.data;
  // NOTE: writes to `state_events`, not `domain_events`. The legacy
  // outbox table is named `domain_events`; renaming this destination
  // (see migration 20260521100000) was the fix for that collision.
  const { error } = await sb.from('state_events').insert({
    event_id: e.eventId,
    kind: e.kind,
    actor_auth_user_id: e.actorAuthUserId,
    tenant_id: e.tenantId,
    idempotency_key: e.idempotencyKey,
    occurred_at: e.occurredAt,
    payload: (e as unknown as { payload: unknown }).payload,
  });
  if (error) {
    // 23505 = unique_violation = same idempotencyKey already exists.
    // Treat as success-equivalent; the previous publish already ran.
    if (error.code === '23505') {
      return { published: true, reason: 'duplicate' };
    }
    return {
      published: false,
      reason: 'db_error',
      errorMessage: error.message.slice(0, 500),
    };
  }
  return { published: true };
}

/** Reset the flag cache. Test-only; not exported from the package. */
export function __resetFlagCacheForTests(): void {
  cachedFlagAt = null;
  cachedFlagValue = null;
}
