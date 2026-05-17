import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { tickOne } from '@/lib/state/runtime/tick-one';
import { defaultLog, type SubscriberContext } from '@/lib/state/subscribers/subscriber';
import type { AnySubscriber } from '@/lib/state/subscribers/subscriber';
import { makeServiceSupabase, insertEvent } from '../_helpers/supabase-runtime';

const sb = makeServiceSupabase();
const ctx: SubscriberContext = {
  sb, dryRun: false, now: () => new Date(), log: defaultLog,
};

// ── Cross-file test isolation against the shared staging DB ─────────────
//
// `tickOne(sub, …)` queries `state_events` with
//   .eq('kind', sub.kind).gte('occurred_at', cursor.lastOccurredAt)
// and has no other discriminator. The integration suite runs MULTIPLE files
// (tick-all.test, integration.test, dispatcher.replay.test, …) in parallel
// against the same Supabase staging project, and several of them insert
// `learner.mastery_changed` / `learner.quiz_completed` rows at the same
// hard-coded `2026-05-12T0X:00:00Z` timestamps this file used to use.
// When two such files race, `tick-one`'s `gte()` query picks up the other
// file's rows, blowing past the expected `processed` count (the original
// "expected 3 to be 2" / "expected 3 to be 1" flakes on PR #812 CI).
//
// Fix: give this file a unique per-run timestamp window that no other test
// can sit inside. We use a random far-future year ("3xxx") plus a UUID-derived
// millisecond offset, so the cursor base + every event timestamp this file
// emits is guaranteed disjoint from any other test file's `202x-` events.
// `tickOne`'s `gte('occurred_at', cursor)` then ignores everyone else by
// construction; we no longer have to rely on serializing the global
// `state_events` table across files.
//
// We still clean up our own rows in `beforeEach` / `afterAll` so we don't
// leave debris in staging — but cleanup is bounded by the timestamp window
// (range delete) instead of a `kind`-wide nuke that would clobber concurrent
// tests.

const RUN_TS = makeRunTimestamps();

function makeRunTimestamps() {
  // Random year in [3000, 3999] keeps us well clear of every other test's
  // 202x timestamps and well clear of Postgres timestamptz overflow.
  const year = 3000 + Math.floor(Math.random() * 1000);
  // UUID-derived month/day so concurrent shards of this same file (if CI ever
  // matrix-shards it) also don't collide. We don't need cryptographic
  // strength — only collision avoidance across at most a few hundred runs.
  const uuid = crypto.randomUUID().replace(/-/g, '');
  const monthIdx = parseInt(uuid.slice(0, 2), 16) % 12;       // 0–11
  const dayIdx = (parseInt(uuid.slice(2, 4), 16) % 28) + 1;   // 1–28
  const month = String(monthIdx + 1).padStart(2, '0');
  const day = String(dayIdx).padStart(2, '0');
  const baseDay = `${year}-${month}-${day}`;
  return {
    // Cursor sits one day before the first event so `gte('occurred_at', …)`
    // returns our T01/T02 rows but nothing else.
    cursor: `${baseDay}T00:00:00Z`,
    t01: `${baseDay}T01:00:00Z`,
    t02: `${baseDay}T02:00:00Z`,
    // Lower bound for range cleanup; one full day before the cursor leaves
    // headroom for any future "events at T-1h" additions.
    rangeStart: `${year}-${month}-${String(Math.max(dayIdx - 1, 1)).padStart(2, '0')}T00:00:00Z`,
    rangeEnd: `${year}-${month}-${String(Math.min(dayIdx + 1, 28)).padStart(2, '0')}T23:59:59Z`,
  };
}

async function deleteOurEventsInWindow() {
  // Range-scoped delete: only rows this file inserted (its kind + its
  // far-future timestamp window). Won't disturb other test files running
  // concurrently against the same staging DB.
  for (const kind of ['learner.mastery_changed', 'learner.quiz_completed']) {
    const { error } = await sb.from('state_events')
      .delete()
      .eq('kind', kind)
      .gte('occurred_at', RUN_TS.rangeStart)
      .lte('occurred_at', RUN_TS.rangeEnd);
    if (error) throw new Error(`tick-one cleanup failed for ${kind}: ${error.message}`);
  }
}

beforeEach(async () => {
  await deleteOurEventsInWindow();
  await sb.from('subscriber_offsets').delete().eq('subscriber_name', 'happy');
  await sb.from('subscriber_retry_state').delete().eq('subscriber_name', 'happy');
  await sb.from('subscriber_dead_letters').delete().eq('subscriber_name', 'happy');
  await sb.from('subscriber_offsets').insert({
    subscriber_name: 'happy',
    kind_filter: 'learner.mastery_changed',
    last_processed_occurred_at: RUN_TS.cursor,
  });
});

afterAll(async () => {
  // Belt-and-braces: clear our window so a crashed run doesn't leave debris
  // in staging. Subscriber rows are already cleaned per-test; events have no
  // FK ON DELETE link so we re-run the window delete.
  await deleteOurEventsInWindow();
  await sb.from('subscriber_offsets').delete().eq('subscriber_name', 'happy');
  await sb.from('subscriber_retry_state').delete().eq('subscriber_name', 'happy');
  await sb.from('subscriber_dead_letters').delete().eq('subscriber_name', 'happy');
});

describe('tickOne happy path', () => {
  it('processes events in order and advances cursor', async () => {
    const calls: string[] = [];
    const sub: AnySubscriber = {
      name: 'happy',
      kind: 'learner.mastery_changed',
      async handle(event) { calls.push(event.eventId); },
    };
    await insertEvent(sb, { kind: 'learner.mastery_changed', occurredAt: RUN_TS.t01 });
    await insertEvent(sb, { kind: 'learner.mastery_changed', occurredAt: RUN_TS.t02 });
    const result = await tickOne(sub, { sb, ctx });
    expect(result.processed).toBe(2);
    expect(result.deadLettered).toBe(0);
    expect(calls.length).toBe(2);
    const { data: off } = await sb.from('subscriber_offsets')
      .select('last_processed_occurred_at, events_processed')
      .eq('subscriber_name', 'happy').single();
    expect(off?.last_processed_occurred_at?.startsWith(RUN_TS.t02.slice(0, 19))).toBe(true);
    expect(off?.events_processed).toBe(2);
  });

  it('processes nothing when no events past cursor', async () => {
    const sub: AnySubscriber = {
      name: 'happy', kind: 'learner.mastery_changed',
      async handle() {},
    };
    const result = await tickOne(sub, { sb, ctx });
    expect(result.processed).toBe(0);
    expect(result.deadLettered).toBe(0);
  });

  it('filters by kind', async () => {
    const calls: string[] = [];
    const sub: AnySubscriber = {
      name: 'happy', kind: 'learner.mastery_changed',
      async handle(event) { calls.push(event.eventId); },
    };
    await insertEvent(sb, { kind: 'learner.quiz_completed', occurredAt: RUN_TS.t01 });
    await insertEvent(sb, { kind: 'learner.mastery_changed', occurredAt: RUN_TS.t02 });
    const result = await tickOne(sub, { sb, ctx });
    expect(result.processed).toBe(1);
    expect(calls.length).toBe(1);
  });
});

describe('tickOne retry path', () => {
  it('persists attempt_count on failure and does not advance cursor', async () => {
    const sub: AnySubscriber = {
      name: 'happy', kind: 'learner.mastery_changed',
      async handle() { throw new Error('boom'); },
    };
    const e = await insertEvent(sb, { kind: 'learner.mastery_changed', occurredAt: RUN_TS.t01 });

    const r1 = await tickOne(sub, { sb, ctx });
    expect(r1.processed).toBe(0);
    expect(r1.deadLettered).toBe(0);
    const { data: retryRow } = await sb.from('subscriber_retry_state')
      .select('attempt_count, last_error')
      .eq('event_id', e.eventId).eq('subscriber_name', 'happy').single();
    expect(retryRow?.attempt_count).toBe(1);
    expect(retryRow?.last_error).toBe('boom');

    // Cursor unchanged.
    const { data: off } = await sb.from('subscriber_offsets')
      .select('last_processed_occurred_at').eq('subscriber_name', 'happy').single();
    expect(off?.last_processed_occurred_at?.startsWith(RUN_TS.cursor.slice(0, 19))).toBe(true);
  });

  it('dead-letters after maxRetries failed ticks and advances cursor', async () => {
    const sub: AnySubscriber = {
      name: 'happy', kind: 'learner.mastery_changed', maxRetries: 3,
      async handle() { throw new Error('persistent'); },
    };
    const e = await insertEvent(sb, { kind: 'learner.mastery_changed', occurredAt: RUN_TS.t01 });

    await tickOne(sub, { sb, ctx });  // count=1
    await tickOne(sub, { sb, ctx });  // count=2
    // Cursor still unchanged.
    let { data: off } = await sb.from('subscriber_offsets')
      .select('last_processed_occurred_at, events_dead_lettered').eq('subscriber_name', 'happy').single();
    expect(off?.last_processed_occurred_at?.startsWith(RUN_TS.cursor.slice(0, 19))).toBe(true);

    const r3 = await tickOne(sub, { sb, ctx });  // count=3 → dead-letter
    expect(r3.deadLettered).toBe(1);

    const { data: dl } = await sb.from('subscriber_dead_letters')
      .select('attempt_count, last_error')
      .eq('event_id', e.eventId).eq('subscriber_name', 'happy').single();
    expect(dl?.attempt_count).toBe(3);
    expect(dl?.last_error).toBe('persistent');

    // Retry state cleared.
    const { count: retryCount } = await sb.from('subscriber_retry_state')
      .select('*', { count: 'exact', head: true }).eq('event_id', e.eventId);
    expect(retryCount).toBe(0);

    // Cursor advanced past the bad event.
    ({ data: off } = await sb.from('subscriber_offsets')
      .select('last_processed_occurred_at, events_dead_lettered').eq('subscriber_name', 'happy').single());
    expect(off?.last_processed_occurred_at?.startsWith(RUN_TS.t01.slice(0, 19))).toBe(true);
    expect(off?.events_dead_lettered).toBe(1);
  });

  it('clears retry state when handler eventually succeeds', async () => {
    let attempts = 0;
    const sub: AnySubscriber = {
      name: 'happy', kind: 'learner.mastery_changed', maxRetries: 3,
      async handle() { if (++attempts < 2) throw new Error('flake'); },
    };
    const e = await insertEvent(sb, { kind: 'learner.mastery_changed', occurredAt: RUN_TS.t01 });
    await tickOne(sub, { sb, ctx });  // count=1
    const r2 = await tickOne(sub, { sb, ctx });  // success
    expect(r2.processed).toBe(1);
    const { count } = await sb.from('subscriber_retry_state')
      .select('*', { count: 'exact', head: true }).eq('event_id', e.eventId);
    expect(count).toBe(0);
  });

  it('dead-letters an unparseable row after maxRetries ticks', async () => {
    const sub: AnySubscriber = {
      name: 'happy', kind: 'learner.mastery_changed', maxRetries: 3,
      async handle() { /* never called */ },
    };
    // Insert a row that satisfies the table's NOT NULL constraints but whose
    // payload will fail DomainEventSchema.safeParse. LearnerMasteryChangedSchema
    // requires payload to be `z.object({...})` — a string payload trips the
    // discriminated-union parse before any field check, which is exactly the
    // kind of malformation we want this test to cover.
    const eventId = crypto.randomUUID();
    await sb.from('state_events').insert({
      event_id: eventId,
      kind: 'learner.mastery_changed',
      actor_auth_user_id: '00000000-0000-0000-0000-000000000000',
      tenant_id: null,
      idempotency_key: `bad-${eventId}`,
      occurred_at: RUN_TS.t01,
      payload: 'this-should-be-an-object-but-isnt',
    });

    await tickOne(sub, { sb, ctx });  // parse-fail count=1
    await tickOne(sub, { sb, ctx });  // count=2
    const r3 = await tickOne(sub, { sb, ctx });  // count=3 → dead-letter
    expect(r3.deadLettered).toBe(1);

    const { data: dl } = await sb.from('subscriber_dead_letters')
      .select('attempt_count, last_error')
      .eq('event_id', eventId).eq('subscriber_name', 'happy').single();
    expect(dl?.attempt_count).toBe(3);
    expect(dl?.last_error).toContain('schema parse');

    // Cursor advanced past the bad row.
    const { data: off } = await sb.from('subscriber_offsets')
      .select('last_processed_occurred_at').eq('subscriber_name', 'happy').single();
    expect(off?.last_processed_occurred_at?.startsWith(RUN_TS.t01.slice(0, 19))).toBe(true);
  });
});
