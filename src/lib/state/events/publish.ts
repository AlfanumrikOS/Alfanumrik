/**
 * src/lib/state/events/publish.ts — the only function that writes events.
 *
 * Every cross-feature signal in Alfanumrik becomes a row in the
 * `domain_events` table via this function. Subscribers (the
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
  reason?: 'flag_off' | 'validation_failed' | 'db_error' | 'duplicate';
  errorMessage?: string;
}

/**
 * Publish a domain event. Single entry point — every feature calls
 * this; nothing else writes domain_events directly.
 *
 * Returns synchronously when the INSERT completes (typical: <50ms).
 * Subscribers receive via pg_notify channel `domain_events` and
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

  // 2. Flag check. A feature being "wired" to publish is independent of
  //    the bus being live for that tenant; the gate sits here, once.
  if (!(await isBusEnabled(sb))) {
    return { published: false, reason: 'flag_off' };
  }

  // 3. Insert. The UNIQUE constraint on idempotencyKey makes retries safe.
  const e = parsed.data;
  const { error } = await sb.from('domain_events').insert({
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
