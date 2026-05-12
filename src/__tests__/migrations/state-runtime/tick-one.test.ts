import { describe, it, expect, beforeEach } from 'vitest';
import { tickOne } from '@/lib/state/runtime/tick-one';
import { defaultLog, type SubscriberContext } from '@/lib/state/subscribers/subscriber';
import type { AnySubscriber } from '@/lib/state/subscribers/subscriber';
import { makeServiceSupabase, insertEvent } from '../_helpers/supabase-runtime';

const sb = makeServiceSupabase();
const ctx: SubscriberContext = {
  sb, dryRun: false, now: () => new Date(), log: defaultLog,
};

beforeEach(async () => {
  await sb.from('state_events').delete().eq('kind', 'learner.mastery_changed');
  await sb.from('state_events').delete().eq('kind', 'learner.quiz_completed');
  await sb.from('subscriber_offsets').delete().eq('subscriber_name', 'happy');
  await sb.from('subscriber_retry_state').delete().eq('subscriber_name', 'happy');
  await sb.from('subscriber_dead_letters').delete().eq('subscriber_name', 'happy');
  await sb.from('subscriber_offsets').insert({
    subscriber_name: 'happy',
    kind_filter: 'learner.mastery_changed',
    last_processed_occurred_at: '2026-05-12T00:00:00Z',
  });
});

describe('tickOne happy path', () => {
  it('processes events in order and advances cursor', async () => {
    const calls: string[] = [];
    const sub: AnySubscriber = {
      name: 'happy',
      kind: 'learner.mastery_changed',
      async handle(event) { calls.push(event.eventId); },
    };
    await insertEvent(sb, { kind: 'learner.mastery_changed', occurredAt: '2026-05-12T01:00:00Z' });
    await insertEvent(sb, { kind: 'learner.mastery_changed', occurredAt: '2026-05-12T02:00:00Z' });
    const result = await tickOne(sub, { sb, ctx });
    expect(result.processed).toBe(2);
    expect(result.deadLettered).toBe(0);
    expect(calls.length).toBe(2);
    const { data: off } = await sb.from('subscriber_offsets')
      .select('last_processed_occurred_at, events_processed')
      .eq('subscriber_name', 'happy').single();
    expect(off?.last_processed_occurred_at?.startsWith('2026-05-12T02:00:00')).toBe(true);
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
    await insertEvent(sb, { kind: 'learner.quiz_completed', occurredAt: '2026-05-12T01:00:00Z' });
    await insertEvent(sb, { kind: 'learner.mastery_changed', occurredAt: '2026-05-12T02:00:00Z' });
    const result = await tickOne(sub, { sb, ctx });
    expect(result.processed).toBe(1);
    expect(calls.length).toBe(1);
  });
});
