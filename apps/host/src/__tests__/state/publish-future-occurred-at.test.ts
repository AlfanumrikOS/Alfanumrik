import { describe, it, expect, beforeEach } from 'vitest';
import { publishEvent, __resetFlagCacheForTests } from '@alfanumrik/lib/state/events/publish';
import type { DomainEvent } from '@alfanumrik/lib/state/events/registry';

/**
 * POISON-WATERMARK GUARD at the publisher edge — testing-strategy Phase 1,
 * gap 7 (dead-letter root-cause follow-up).
 *
 * WHAT HAPPENED IN PROD (2026-07-13)
 * ==================================
 * The bus cursor (packages/lib/src/state/runtime/tick-one.ts) fetches
 * `.gte('occurred_at', cursor)` ordered by occurred_at, and advances the
 * watermark to each processed OR dead-lettered event's occurred_at. A poison
 * `learner.mastery_changed` event stamped occurred_at=2032 (payload was a bare
 * string, so it dead-lettered) advanced `mastery-state-writer`'s watermark to
 * 2032. From that point every real, now-stamped mastery event is BELOW the
 * cursor and is silently skipped until wall-clock reaches 2032 — a time-bomb,
 * not just log noise. (Confirmed live: subscriber_dead_letters had 2 rows for
 * this one event; subscriber_offsets.last_processed_occurred_at = 2032.)
 *
 * THIS GUARD closes the SANCTIONED entry path: publishEvent() now refuses an
 * event whose occurredAt is >24h in the future (always a bug or poison), so it
 * can never enter the bus and poison a watermark. The 24h slack is generous
 * enough that no legitimate now-stamped caller — even with clock skew or a
 * queued retry — is affected.
 *
 * NOT COVERED (by design, documented in publish.ts): a raw service-role INSERT
 * into state_events bypasses publishEvent (that is how the 2026-07-13 poison
 * arrived — a dead-letter negative-test seed). The durable structural fix is to
 * order the cursor by the server-set monotonic `created_at` instead of
 * caller-supplied `occurred_at` — an architect-owned follow-up.
 *
 * Canonical module under test: `@alfanumrik/lib/state/events/publish`
 * (packages/lib/src) — the path all 19 production callers import. The stale
 * apps/host/src/lib/state/events/publish.ts duplicate is NOT imported by prod.
 */

function baseEvent(occurredAt: string): DomainEvent {
  return {
    eventId: '824f3f71-3973-4661-b467-aebd1970788a',
    occurredAt,
    actorAuthUserId: '11111111-1111-4111-8111-111111111111',
    tenantId: null,
    idempotencyKey: `test-${occurredAt}`,
    kind: 'learner.mastery_changed',
    payload: {
      subjectCode: 'MATH',
      chapterNumber: 1,
      fromMastery: 0.2,
      toMastery: 0.4,
      trigger: 'quiz',
    },
  } as unknown as DomainEvent;
}

// Supabase stub recording whether an INSERT was attempted. The guard must
// short-circuit BEFORE any DB call, so `insert` must never run for a rejected
// event. The flag lookup returns enabled so we prove the guard fires
// independently of the flag gate.
function stubClient() {
  const calls = { inserted: 0, flagRead: 0 };
  const client = {
    from(table: string) {
      if (table === 'feature_flags') {
        calls.flagRead += 1;
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { is_enabled: true }, error: null }),
            }),
          }),
        };
      }
      if (table === 'state_events') {
        return {
          insert: async () => {
            calls.inserted += 1;
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { client, calls };
}

describe('publishEvent — future-occurredAt poison-watermark guard (gap 7)', () => {
  beforeEach(() => {
    __resetFlagCacheForTests();
  });

  it('refuses an event stamped far in the future and writes nothing', async () => {
    const { client, calls } = stubClient();
    const res = await publishEvent(client as never, baseEvent('2032-03-20T06:55:27.123Z'));
    expect(res.published).toBe(false);
    expect(res.reason).toBe('future_occurred_at');
    expect(calls.inserted, 'no INSERT may happen for a rejected event').toBe(0);
  });

  it('publishes a now-stamped event (guard does not fire on the happy path)', async () => {
    const { client, calls } = stubClient();
    const now = new Date().toISOString();
    const res = await publishEvent(client as never, baseEvent(now));
    expect(res.published).toBe(true);
    expect(calls.inserted).toBe(1);
  });

  it('allows an event slightly in the future (within the 24h skew window)', async () => {
    const { client, calls } = stubClient();
    const soon = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // +1h
    const res = await publishEvent(client as never, baseEvent(soon));
    expect(res.published).toBe(true);
    expect(calls.inserted).toBe(1);
  });

  it('rejects just past the 24h boundary', async () => {
    const { client, calls } = stubClient();
    const tooFar = new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString(); // +25h
    const res = await publishEvent(client as never, baseEvent(tooFar));
    expect(res.published).toBe(false);
    expect(res.reason).toBe('future_occurred_at');
    expect(calls.inserted).toBe(0);
  });
});
