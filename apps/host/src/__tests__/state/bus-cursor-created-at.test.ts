import { describe, it, expect } from 'vitest';
import { tickOne } from '@alfanumrik/lib/state/runtime/tick-one';
import type { AnySubscriber } from '@alfanumrik/lib/state/subscribers/subscriber';

/**
 * BUS CURSOR ORDERS BY created_at, NOT occurred_at — testing-strategy Phase 2
 * (durable poison-watermark fix; always-on unit lane).
 *
 * INCIDENT (2026-07-13): tickOne fetched `.gte('occurred_at', cursor)
 * .order('occurred_at')` and advanced the watermark to each event's
 * occurred_at. occurred_at is caller-supplied; a row stamped occurred_at=2032
 * (seeded by an integration test into a shared DB) advanced a live
 * subscriber's watermark to 2032, silently skipping every real event.
 *
 * FIX: order + advance by `created_at` (server-set, monotonic ingestion time).
 * This test pins that the query and the written watermark both use created_at,
 * and that a far-future occurred_at can no longer set the cursor — so a later-
 * INGESTED real event is never skipped.
 */

const EVENT_A = {
  event_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  kind: 'learner.mastery_changed',
  actor_auth_user_id: '11111111-1111-4111-8111-111111111111',
  tenant_id: null,
  idempotency_key: 'A',
  // Poison-shaped: occurred_at far in the FUTURE, but ingested FIRST.
  occurred_at: '2032-03-20T06:55:27.123Z',
  created_at: '2026-07-13T10:00:00.000Z',
  payload: { subjectCode: 'MATH', chapterNumber: 1, fromMastery: 0.2, toMastery: 0.4, trigger: 'quiz' },
};
const EVENT_B = {
  event_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  kind: 'learner.mastery_changed',
  actor_auth_user_id: '11111111-1111-4111-8111-111111111111',
  tenant_id: null,
  idempotency_key: 'B',
  // Real: now-stamped occurred_at, ingested SECOND.
  occurred_at: '2026-07-13T10:00:05.000Z',
  created_at: '2026-07-13T10:00:05.000Z',
  payload: { subjectCode: 'MATH', chapterNumber: 2, fromMastery: 0.4, toMastery: 0.5, trigger: 'quiz' },
};

// Cursor before both events (older ingestion time), with the created_at column
// already backfilled.
const OFFSET_ROW = {
  last_processed_event_id: null,
  last_processed_occurred_at: '2026-07-13T09:00:00.000Z',
  last_processed_created_at: '2026-07-13T09:00:00.000Z',
  events_processed: 0,
  events_dead_lettered: 0,
  kind_filter: 'learner.mastery_changed',
};

function makeSb(rows: unknown[]) {
  const calls = {
    gteCol: null as string | null,
    orderCols: [] as string[],
    upserted: null as Record<string, unknown> | null,
  };
  const from = (table: string) => {
    const q: Record<string, unknown> = {};
    Object.assign(q, {
      select: () => q,
      eq: () => q,
      is: () => q,
      gte: (col: string) => {
        if (table === 'state_events') calls.gteCol = col;
        return q;
      },
      order: (col: string) => {
        if (table === 'state_events') calls.orderCols.push(col);
        return q;
      },
      limit: () =>
        Promise.resolve({ data: table === 'state_events' ? rows : [], error: null }),
      maybeSingle: () =>
        Promise.resolve({ data: table === 'subscriber_offsets' ? OFFSET_ROW : null, error: null }),
      upsert: (payload: Record<string, unknown>) => {
        if (table === 'subscriber_offsets') calls.upserted = payload;
        return Promise.resolve({ error: null });
      },
      delete: () => q,
      insert: () => Promise.resolve({ error: null }),
    });
    return q;
  };
  return { sb: { from } as never, calls };
}

const subscriber = {
  name: 'test-mastery-writer',
  kind: 'learner.mastery_changed',
  maxRetries: 3,
  handle: async () => {
    /* succeed */
  },
} as unknown as AnySubscriber;

const ctx = { sb: null as never, dryRun: false, now: () => new Date('2026-07-13T10:01:00Z'), log: () => {} };

describe('bus cursor orders by created_at (poison-watermark fix)', () => {
  it('queries and orders state_events by created_at, not occurred_at', async () => {
    const { sb, calls } = makeSb([EVENT_A, EVENT_B]);
    await tickOne(subscriber, { sb, ctx: { ...ctx, sb } });
    expect(calls.gteCol).toBe('created_at');
    expect(calls.orderCols).toContain('created_at');
    expect(calls.orderCols).toContain('event_id');
    expect(calls.orderCols).not.toContain('occurred_at');
  });

  it('advances the watermark by created_at — a far-future occurred_at does NOT set the cursor', async () => {
    const { sb, calls } = makeSb([EVENT_A, EVENT_B]);
    const res = await tickOne(subscriber, { sb, ctx: { ...ctx, sb } });
    expect(res.processed).toBe(2);
    expect(calls.upserted).not.toBeNull();
    // The cursor is the LAST-INGESTED event's created_at (B), never the poison's
    // occurred_at=2032. Under the old occurred_at ordering the watermark would
    // have jumped to 2032 and skipped all later real events.
    expect(calls.upserted!.last_processed_created_at).toBe(EVENT_B.created_at);
    expect(calls.upserted!.last_processed_event_id).toBe(EVENT_B.event_id);
    expect(calls.upserted!.last_processed_created_at).not.toBe('2032-03-20T06:55:27.123Z');
  });
});
