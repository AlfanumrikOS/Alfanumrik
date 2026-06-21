import { describe, it, expect, beforeEach } from 'vitest';
import { tickOne } from '@/lib/state/runtime/tick-one';
import { defaultLog, type SubscriberContext } from '@/lib/state/subscribers/subscriber';
import type { AnySubscriber } from '@/lib/state/subscribers/subscriber';
import { makeServiceSupabase, insertEvent } from '../_helpers/supabase-runtime';

const sb = makeServiceSupabase();
const ctx: SubscriberContext = {
  sb, dryRun: false, now: () => new Date(), log: defaultLog,
};

// Each run gets a unique second-offset (0..65535 s ≈ 18 h spread) derived from
// the first 4 hex digits of a fresh UUID. Events are placed ~1 year in the
// future at that offset, so: (a) stale events from prior CI runs at the usual
// 2026-05-12 fixtures never contaminate this run's cursor scan, and (b) two
// concurrent runs almost certainly land in different seconds.
const RUN_ID     = crypto.randomUUID().replace(/-/g, '');
const OFFSET_SEC = parseInt(RUN_ID.slice(0, 4), 16);  // 0..65535
const FUTURE     = Date.now() + 365 * 24 * 3600_000 + OFFSET_SEC * 1000;
const CURSOR     = new Date(FUTURE - 1000).toISOString();   // 1 s before T1
const T1         = new Date(FUTURE).toISOString();
const T2         = new Date(FUTURE + 1000).toISOString();   // T1 + 1 s

const HAPPY = `happy-${RUN_ID.slice(0, 6)}`;

beforeEach(async () => {
  await sb.from('subscriber_offsets').delete().eq('subscriber_name', HAPPY);
  await sb.from('subscriber_retry_state').delete().eq('subscriber_name', HAPPY);
  await sb.from('subscriber_dead_letters').delete().eq('subscriber_name', HAPPY);
  // Delete only events in this run's unique time window.
  await sb.from('state_events').delete().gte('occurred_at', CURSOR).lte('occurred_at', T2);
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
    await insertEvent(sb, { kind: 'learner.mastery_changed', occurredAt: T1 });
    await insertEvent(sb, { kind: 'learner.mastery_changed', occurredAt: T2 });
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
    await insertEvent(sb, { kind: 'learner.quiz_completed',  occurredAt: T1 });
    await insertEvent(sb, { kind: 'learner.mastery_changed', occurredAt: T2 });
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
    const e = await insertEvent(sb, { kind: 'learner.mastery_changed', occurredAt: T1 });

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
    const e = await insertEvent(sb, { kind: 'learner.mastery_changed', occurredAt: T1 });

    await tickOne(sub, { sb, ctx });  // count=1
    await tickOne(sub, { sb, ctx });  // count=2
    // Cursor still unchanged.
    let { data: off } = await sb.from('subscriber_offsets')
      .select('last_processed_occurred_at, events_dead_lettered').eq('subscriber_name', HAPPY).single();
    expect(off?.last_processed_occurred_at?.startsWith(CURSOR.slice(0, 19))).toBe(true);

    const r3 = await tickOne(sub, { sb, ctx });  // count=3 → dead-letter
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
    const e = await insertEvent(sb, { kind: 'learner.mastery_changed', occurredAt: T1 });
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
      actor_auth_user_id: '00000000-0000-0000-0000-000000000000',
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
