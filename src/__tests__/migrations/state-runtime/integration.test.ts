import { describe, it, expect, beforeEach } from 'vitest';
import { tickAll } from '@/lib/state/runtime/tick-all';
import { __resetFlagCacheForTests } from '@/lib/state/runtime/flag';
import { createDispatcher } from '@/lib/state/subscribers/dispatcher';
import type { AnySubscriber } from '@/lib/state/subscribers/subscriber';
import { defaultLog, type SubscriberContext } from '@/lib/state/subscribers/subscriber';
import { makeServiceSupabase, insertEvent } from '../_helpers/supabase-runtime';

const sb = makeServiceSupabase();
const ctx: SubscriberContext = { sb, dryRun: false, now: () => new Date(), log: defaultLog };

// Unique run ID prevents concurrent CI runs on the same live DB from colliding.
const RUN_ID  = crypto.randomUUID().replace(/-/g, '').slice(0, 6);
const MS      = String(parseInt(RUN_ID.slice(0, 3), 16) % 1000).padStart(3, '0');
const SOK     = `ok-${RUN_ID}`;
const SBAD    = `bad-${RUN_ID}`;
const CURSOR  = `2026-05-12T00:00:00.${MS}Z`;
const T1      = `2026-05-12T01:00:00.${MS}Z`;
const T2      = `2026-05-12T02:00:00.${MS}Z`;

beforeEach(async () => {
  for (const name of [SOK, SBAD]) {
    await sb.from('subscriber_offsets').delete().eq('subscriber_name', name);
    await sb.from('subscriber_retry_state').delete().eq('subscriber_name', name);
    await sb.from('subscriber_dead_letters').delete().eq('subscriber_name', name);
  }
  await sb.from('state_events').delete().in('occurred_at', [T1, T2]);
  await sb.from('feature_flags').delete().eq('flag_name', 'ff_projector_runner_v1');
  __resetFlagCacheForTests();
  await sb.from('feature_flags').insert({
    flag_name: 'ff_projector_runner_v1', is_enabled: true,
    rollout_percentage: 100, target_environments: [],
  });
});

describe('integration: tickAll with two subscribers across 3 ticks', () => {
  it('failing subscriber dead-letters its bad event after 3 ticks; good subscriber unaffected', async () => {
    let badAttempts = 0;
    const badSub: AnySubscriber = {
      name: SBAD, kind: 'learner.quiz_completed', maxRetries: 3,
      async handle() { badAttempts += 1; throw new Error('always fails'); },
    };
    const okCalls: string[] = [];
    const okSub: AnySubscriber = {
      name: SOK, kind: 'learner.mastery_changed',
      async handle(e) { okCalls.push(e.eventId); },
    };
    await sb.from('subscriber_offsets').insert([
      { subscriber_name: SBAD, kind_filter: 'learner.quiz_completed',  last_processed_occurred_at: CURSOR },
      { subscriber_name: SOK,  kind_filter: 'learner.mastery_changed', last_processed_occurred_at: CURSOR },
    ]);

    const bad = await insertEvent(sb, { kind: 'learner.quiz_completed',  occurredAt: T1 });
    await insertEvent(sb, { kind: 'learner.mastery_changed', occurredAt: T1 });
    await insertEvent(sb, { kind: 'learner.mastery_changed', occurredAt: T2 });

    const dispatcher = createDispatcher([badSub, okSub]);
    await tickAll({ sb, ctx, dispatcher });  // tick 1: badAttempts=1, retry state count=1; ok processes both events
    await tickAll({ sb, ctx, dispatcher });  // tick 2: badAttempts=2, retry state count=2; ok has nothing new
    const r3 = await tickAll({ sb, ctx, dispatcher });  // tick 3: badAttempts=3, dead-letter

    expect(badAttempts).toBe(3);
    const badResult = r3.perSubscriber.find(r => r.subscriberName === SBAD);
    expect(badResult?.deadLettered).toBe(1);

    const { data: dl } = await sb.from('subscriber_dead_letters')
      .select('attempt_count, last_error')
      .eq('event_id', bad.eventId).eq('subscriber_name', SBAD).single();
    expect(dl?.attempt_count).toBe(3);
    expect(dl?.last_error).toBe('always fails');

    // Retry state cleared after dead-letter.
    const { count: retryCount } = await sb.from('subscriber_retry_state')
      .select('*', { count: 'exact', head: true })
      .eq('subscriber_name', SBAD);
    expect(retryCount).toBe(0);

    // bad subscriber's cursor advanced past the dead-lettered event.
    const { data: badOffset } = await sb.from('subscriber_offsets')
      .select('last_processed_occurred_at, events_dead_lettered')
      .eq('subscriber_name', SBAD).single();
    expect(badOffset?.last_processed_occurred_at?.startsWith('2026-05-12T01:00:00')).toBe(true);
    expect(badOffset?.events_dead_lettered).toBe(1);

    // ok subscriber processed both its events on tick 1; nothing on ticks 2/3.
    expect(okCalls.length).toBe(2);
    const { data: okOffset } = await sb.from('subscriber_offsets')
      .select('last_processed_occurred_at, events_processed')
      .eq('subscriber_name', SOK).single();
    expect(okOffset?.last_processed_occurred_at?.startsWith('2026-05-12T02:00:00')).toBe(true);
    expect(okOffset?.events_processed).toBe(2);
  });
});
