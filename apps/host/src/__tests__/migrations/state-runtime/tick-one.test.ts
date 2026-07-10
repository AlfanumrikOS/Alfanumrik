import { describe, it, expect, beforeEach } from 'vitest';
import { tickOne } from '@alfanumrik/lib/state/runtime/tick-one';
import { defaultLog, type SubscriberContext } from '@alfanumrik/lib/state/subscribers/subscriber';
import type { AnySubscriber } from '@alfanumrik/lib/state/subscribers/subscriber';
import { makeServiceSupabase, insertEvent } from '../_helpers/supabase-runtime';

const sb = makeServiceSupabase();
const ctx: SubscriberContext = {
  sb, dryRun: false, now: () => new Date(), log: defaultLog,
};

// Each run tags its events with a unique RUN_ACTOR_ID (a per-run UUID). beforeEach
// (a) deletes only OUR events by RUN_ACTOR_ID — safe against concurrent runs, and
// (b) deletes OLD events with the default actor-ID in our range — handles accumulated
// past-run contamination without touching concurrent runs (they use their own IDs).
const RUN_ID       = crypto.randomUUID().replace(/-/g, '');
const RUN_ACTOR_ID = crypto.randomUUID();                // unique per-run event tag

// Per-run base, far in the future and randomly offset so concurrent/past runs
// occupy different ~136-year bands (cross-run separation — same intent as before).
const RUN_OFFSET_SEC = parseInt(RUN_ID.slice(0, 8), 16); // 0..4294967295 ≈ 136-year spread
const RUN_BASE_MS    = Date.now() + 365 * 24 * 3600_000 + RUN_OFFSET_SEC * 1000;

const HAPPY = `happy-${RUN_ID.slice(0, 6)}`;

// PER-TEST window, recomputed in beforeEach. `tickOne` selects events purely by
// `kind` + `occurred_at >= cursor` — an OPEN-ENDED-UPWARD read with NO actor
// scoping (see src/lib/state/runtime/tick-one.ts). A single window shared across
// cases is therefore fragile on the shared staging DB: if the delete of a prior
// case's RUN_ACTOR_ID events lags (replication/visibility delay), those rows are
// still `>= CURSOR` for the next case and get swept in, inflating the pinned
// counts (the observed "expected 0, got 1" / "expected 1, got 2" false-reds).
//
// Fix: give each case a window that is strictly ABOVE every prior case's events.
// Because the read is open-ended upward, a STRICTLY-INCREASING per-test cursor is
// the only thing that guarantees a leftover row falls OUTSIDE (below) this case's
// window and cannot be selected. (A purely-random per-test offset would NOT close
// this — ~half the time the prior window lands above the current cursor and its
// rows are still selected.) A 1 h stride between cases dwarfs any plausible
// insert/delete latency; the sub-stride random jitter keeps each window unique
// without breaking the strict ordering the stride guarantees.
const TEST_STRIDE_MS = 3600_000;            // 1 h between consecutive test windows
let   windowSeq      = 0;
let   CURSOR         = '';                   // 1 s before T1
let   T1             = '';
let   T2             = '';                   // T1 + 1 s

beforeEach(async () => {
  // Fresh, strictly-increasing window for THIS test. jitter < stride/2 so the
  // ordering window_n.T2 < window_{n+1}.CURSOR always holds.
  windowSeq += 1;
  const jitterMs = parseInt(crypto.randomUUID().replace(/-/g, '').slice(0, 6), 16) % (TEST_STRIDE_MS / 2);
  const future   = RUN_BASE_MS + windowSeq * TEST_STRIDE_MS + jitterMs;
  CURSOR = new Date(future - 1000).toISOString();
  T1     = new Date(future).toISOString();
  T2     = new Date(future + 1000).toISOString();

  await sb.from('subscriber_offsets').delete().eq('subscriber_name', HAPPY);
  await sb.from('subscriber_retry_state').delete().eq('subscriber_name', HAPPY);
  await sb.from('subscriber_dead_letters').delete().eq('subscriber_name', HAPPY);
  // (a) Delete our own events from the previous test — safe: other runs have different RUN_ACTOR_IDs.
  //     Kept as defense-in-depth; the per-test strictly-increasing window above is
  //     what makes the suite robust even if this delete hasn't propagated yet.
  await sb.from('state_events').delete().eq('actor_auth_user_id', RUN_ACTOR_ID);
  // (b) Delete accumulated past-run events (old runs used the default zero UUID) in our range.
  await sb.from('state_events').delete()
    .eq('actor_auth_user_id', '00000000-0000-0000-0000-000000000000')
    .eq('kind', 'learner.mastery_changed')
    .gte('occurred_at', CURSOR);
  await sb.from('subscriber_offsets').insert({
    subscriber_name: HAPPY,
    kind_filter: 'learner.mastery_changed',
    last_processed_occurred_at: CURSOR,
  });
});

describe('tickOne happy path', () => {
  it('processes events in order and advances cursor', async () => {
    const calls: string[] = [];
    const sub: AnySubscriber = {
      name: HAPPY,
      kind: 'learner.mastery_changed',
      async handle(event) { calls.push(event.eventId); },
    };
    await insertEvent(sb, { kind: 'learner.mastery_changed', occurredAt: T1, actorAuthUserId: RUN_ACTOR_ID });
    await insertEvent(sb, { kind: 'learner.mastery_changed', occurredAt: T2, actorAuthUserId: RUN_ACTOR_ID });
    const result = await tickOne(sub, { sb, ctx });
    expect(result.processed).toBe(2);
    expect(result.deadLettered).toBe(0);
    expect(calls.length).toBe(2);
    const { data: off } = await sb.from('subscriber_offsets')
      .select('last_processed_occurred_at, events_processed')
      .eq('subscriber_name', HAPPY).single();
    expect(off?.last_processed_occurred_at?.startsWith(T2.slice(0, 19))).toBe(true);
    expect(off?.events_processed).toBe(2);
  });

  it('processes nothing when no events past cursor', async () => {
    const sub: AnySubscriber = {
      name: HAPPY, kind: 'learner.mastery_changed',
      async handle() {},
    };
    const result = await tickOne(sub, { sb, ctx });
    expect(result.processed).toBe(0);
    expect(result.deadLettered).toBe(0);
  });

  it('filters by kind', async () => {
    const calls: string[] = [];
    const sub: AnySubscriber = {
      name: HAPPY, kind: 'learner.mastery_changed',
      async handle(event) { calls.push(event.eventId); },
    };
    await insertEvent(sb, { kind: 'learner.quiz_completed', occurredAt: T1, actorAuthUserId: RUN_ACTOR_ID });
    await insertEvent(sb, { kind: 'learner.mastery_changed', occurredAt: T2, actorAuthUserId: RUN_ACTOR_ID });
    const result = await tickOne(sub, { sb, ctx });
    expect(result.processed).toBe(1);
    expect(calls.length).toBe(1);
  });
});

describe('tickOne retry path', () => {
  it('persists attempt_count on failure and does not advance cursor', async () => {
    const sub: AnySubscriber = {
      name: HAPPY, kind: 'learner.mastery_changed',
      async handle() { throw new Error('boom'); },
    };
    const e = await insertEvent(sb, { kind: 'learner.mastery_changed', occurredAt: T1, actorAuthUserId: RUN_ACTOR_ID });

    const r1 = await tickOne(sub, { sb, ctx });
    expect(r1.processed).toBe(0);
    expect(r1.deadLettered).toBe(0);
    const { data: retryRow } = await sb.from('subscriber_retry_state')
      .select('attempt_count, last_error')
      .eq('event_id', e.eventId).eq('subscriber_name', HAPPY).single();
    expect(retryRow?.attempt_count).toBe(1);
    expect(retryRow?.last_error).toBe('boom');

    // Cursor unchanged.
    const { data: off } = await sb.from('subscriber_offsets')
      .select('last_processed_occurred_at').eq('subscriber_name', HAPPY).single();
    expect(off?.last_processed_occurred_at?.startsWith(CURSOR.slice(0, 19))).toBe(true);
  });

  it('dead-letters after maxRetries failed ticks and advances cursor', async () => {
    const sub: AnySubscriber = {
      name: HAPPY, kind: 'learner.mastery_changed', maxRetries: 3,
      async handle() { throw new Error('persistent'); },
    };
    const e = await insertEvent(sb, { kind: 'learner.mastery_changed', occurredAt: T1, actorAuthUserId: RUN_ACTOR_ID });

    await tickOne(sub, { sb, ctx, batchSize: 1 });  // count=1
    await tickOne(sub, { sb, ctx, batchSize: 1 });  // count=2
    // Cursor still unchanged.
    let { data: off } = await sb.from('subscriber_offsets')
      .select('last_processed_occurred_at, events_dead_lettered').eq('subscriber_name', HAPPY).single();
    expect(off?.last_processed_occurred_at?.startsWith(CURSOR.slice(0, 19))).toBe(true);

    const r3 = await tickOne(sub, { sb, ctx, batchSize: 1 });  // count=3 → dead-letter
    expect(r3.deadLettered).toBe(1);

    const { data: dl } = await sb.from('subscriber_dead_letters')
      .select('attempt_count, last_error')
      .eq('event_id', e.eventId).eq('subscriber_name', HAPPY).single();
    expect(dl?.attempt_count).toBe(3);
    expect(dl?.last_error).toBe('persistent');

    // Retry state cleared.
    const { count: retryCount } = await sb.from('subscriber_retry_state')
      .select('*', { count: 'exact', head: true }).eq('event_id', e.eventId);
    expect(retryCount).toBe(0);

    // Cursor advanced past the bad event.
    ({ data: off } = await sb.from('subscriber_offsets')
      .select('last_processed_occurred_at, events_dead_lettered').eq('subscriber_name', HAPPY).single());
    expect(off?.last_processed_occurred_at?.startsWith(T1.slice(0, 19))).toBe(true);
    expect(off?.events_dead_lettered).toBe(1);
  });

  it('clears retry state when handler eventually succeeds', async () => {
    let attempts = 0;
    const sub: AnySubscriber = {
      name: HAPPY, kind: 'learner.mastery_changed', maxRetries: 3,
      async handle() { if (++attempts < 2) throw new Error('flake'); },
    };
    const e = await insertEvent(sb, { kind: 'learner.mastery_changed', occurredAt: T1, actorAuthUserId: RUN_ACTOR_ID });
    await tickOne(sub, { sb, ctx });  // count=1
    const r2 = await tickOne(sub, { sb, ctx });  // success
    expect(r2.processed).toBe(1);
    const { count } = await sb.from('subscriber_retry_state')
      .select('*', { count: 'exact', head: true }).eq('event_id', e.eventId);
    expect(count).toBe(0);
  });

  it('dead-letters an unparseable row after maxRetries ticks', async () => {
    const sub: AnySubscriber = {
      name: HAPPY, kind: 'learner.mastery_changed', maxRetries: 3,
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
      actor_auth_user_id: RUN_ACTOR_ID,  // tag so our cleanup (step a) can remove it
      tenant_id: null,
      idempotency_key: `bad-${eventId}`,
      occurred_at: T1,
      payload: 'this-should-be-an-object-but-isnt',
    });

    await tickOne(sub, { sb, ctx });  // parse-fail count=1
    await tickOne(sub, { sb, ctx });  // count=2
    const r3 = await tickOne(sub, { sb, ctx });  // count=3 → dead-letter
    expect(r3.deadLettered).toBe(1);

    const { data: dl } = await sb.from('subscriber_dead_letters')
      .select('attempt_count, last_error')
      .eq('event_id', eventId).eq('subscriber_name', HAPPY).single();
    expect(dl?.attempt_count).toBe(3);
    expect(dl?.last_error).toContain('schema parse');

    // Cursor advanced past the bad row.
    const { data: off } = await sb.from('subscriber_offsets')
      .select('last_processed_occurred_at').eq('subscriber_name', HAPPY).single();
    expect(off?.last_processed_occurred_at?.startsWith(T1.slice(0, 19))).toBe(true);
  });
});
