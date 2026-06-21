/**
 * Public API v1 — Outbound Webhook ENQUEUE helper (Track A.6).
 * ============================================================================
 * `enqueueWebhook(schoolId, eventType, payload)` fans an event out to EVERY
 * active `webhook_subscriptions` row in that school whose `event_types` array
 * contains `eventType`, by inserting one `webhook_deliveries` row per matching
 * subscription (status='pending', next_retry_at=now()). The Edge-Function
 * dispatcher (supabase/functions/webhook-dispatcher/) then signs + POSTs them.
 *
 * This is the PRODUCER half of the outbound webhook system. It is:
 *   - TENANT-SCOPED: only subscriptions for the SAME `schoolId` are matched, and
 *     the delivery row copies that `school_id` (denormalised for the dispatcher).
 *   - FAIL-SAFE: a producer wiring this in MUST NOT have its primary operation
 *     fail because webhook fan-out failed. Callers invoke it as a fire-and-forget
 *     (`void enqueueWebhook(...)`); internally every error is swallowed + logged.
 *   - IDEMPOTENT per call via a caller-supplied `eventId`: the dispatcher dedupes
 *     by (subscription_id, event id), and re-enqueuing the SAME (subscription,
 *     eventId) is harmless because the delivery payload stamps `event_id`.
 *   - P13-CLEAN: logs carry counts + the event TYPE + the school id only — never
 *     the payload contents (which may name students), never any secret.
 *
 * NOTE: this is the OUTBOUND school-integration webhook system. It is COMPLETELY
 * SEPARATE from the Razorpay inbound payment webhook (P11) — different tables,
 * different secret, different direction. Do not conflate them.
 */

import { randomUUID } from 'node:crypto';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

/** The delivery envelope the dispatcher signs + sends (also what dedupe keys on). */
export interface WebhookEnvelope {
  /** Stable per-event id — the dispatcher dedupes on (subscription_id, event_id). */
  event_id: string;
  /** Event name, e.g. 'roster.import.completed'. */
  event_type: string;
  /** ISO timestamp the event was produced. */
  occurred_at: string;
  /** The school the event belongs to (so a receiver can branch without a lookup). */
  school_id: string;
  /** Event-specific body. MUST NOT carry surplus PII (P13) — keep it to counts/ids. */
  data: Record<string, unknown>;
}

export interface EnqueueResult {
  /** Number of delivery rows inserted (one per matching active subscription). */
  enqueued: number;
  /** Number of active subscriptions matched for this event_type. */
  matched: number;
}

/**
 * Enqueue an outbound webhook for every active subscription in `schoolId` that
 * subscribes to `eventType`. Never throws — returns counts; on any failure
 * returns `{ enqueued: 0, matched: 0 }` and logs (counts/type only).
 *
 * @param schoolId  Tenant the event belongs to (the ONLY source of tenancy).
 * @param eventType Event name (must match a value in a subscription's event_types).
 * @param payload   Event-specific data (NO surplus PII).
 * @param opts.eventId  Optional caller-supplied event id (for idempotent re-enqueue).
 */
export async function enqueueWebhook(
  schoolId: string,
  eventType: string,
  payload: Record<string, unknown>,
  opts?: { eventId?: string },
): Promise<EnqueueResult> {
  const eventId = opts?.eventId ?? randomUUID();
  const occurredAt = new Date().toISOString();

  try {
    if (!schoolId || !eventType) {
      return { enqueued: 0, matched: 0 };
    }

    const supabase = getSupabaseAdmin();

    // Match active subscriptions in THIS school that contain eventType. The GIN
    // index on event_types backs the `contains` filter efficiently.
    const { data: subs, error: subsError } = await supabase
      .from('webhook_subscriptions')
      .select('id')
      .eq('school_id', schoolId)
      .eq('is_active', true)
      .contains('event_types', [eventType]);

    if (subsError) {
      logger.error('webhook_enqueue_subscription_lookup_failed', {
        error: new Error(subsError.message),
        // P13: type + school only — no payload contents.
        eventType,
        schoolId,
      });
      return { enqueued: 0, matched: 0 };
    }

    const matched = subs?.length ?? 0;
    if (matched === 0) {
      return { enqueued: 0, matched: 0 };
    }

    const envelope: WebhookEnvelope = {
      event_id: eventId,
      event_type: eventType,
      occurred_at: occurredAt,
      school_id: schoolId,
      data: payload ?? {},
    };

    const rows = (subs ?? []).map((s: { id: string }) => ({
      subscription_id: s.id,
      school_id: schoolId,
      event: eventType,
      payload: envelope as unknown as Record<string, unknown>,
      status: 'pending' as const,
      attempts: 0,
      next_retry_at: occurredAt,
    }));

    const { error: insertError, count } = await supabase
      .from('webhook_deliveries')
      .insert(rows, { count: 'exact' });

    if (insertError) {
      logger.error('webhook_enqueue_insert_failed', {
        error: new Error(insertError.message),
        eventType,
        schoolId,
      });
      return { enqueued: 0, matched };
    }

    const enqueued = count ?? rows.length;
    // P13: counts + type + school only.
    logger.info('webhook_enqueued', { eventType, schoolId, matched, enqueued });
    return { enqueued, matched };
  } catch (err) {
    logger.error('webhook_enqueue_exception', {
      error: err instanceof Error ? err : new Error(String(err)),
      eventType,
      schoolId,
    });
    return { enqueued: 0, matched: 0 };
  }
}
