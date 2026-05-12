import { describe, it, expect, beforeEach } from 'vitest';
import { tickAll } from '@/lib/state/runtime/tick-all';
import { __resetFlagCacheForTests } from '@/lib/state/runtime/flag';
import { createDispatcher } from '@/lib/state/subscribers/dispatcher';
import type { AnySubscriber } from '@/lib/state/subscribers/subscriber';
import { defaultLog, type SubscriberContext } from '@/lib/state/subscribers/subscriber';
import { makeServiceSupabase, insertEvent } from '../_helpers/supabase-runtime';

const sb = makeServiceSupabase();
const ctx: SubscriberContext = { sb, dryRun: false, now: () => new Date(), log: defaultLog };

beforeEach(async () => {
  // Clean state for the tests below.
  await sb.from('state_events').delete().eq('kind', 'learner.mastery_changed');
  await sb.from('state_events').delete().eq('kind', 'learner.quiz_completed');
  await sb.from('subscriber_offsets').delete().in('subscriber_name', ['a', 'b', 'ok', 'bad']);
  await sb.from('subscriber_retry_state').delete().in('subscriber_name', ['a', 'b', 'ok', 'bad']);
  await sb.from('subscriber_dead_letters').delete().in('subscriber_name', ['a', 'b', 'ok', 'bad']);
  await sb.from('feature_flags').delete().eq('flag_name', 'ff_projector_runner_v1');
  __resetFlagCacheForTests();
});

describe('tickAll', () => {
  it('returns { skipped: true } when flag is OFF', async () => {
    await sb.from('feature_flags').insert({
      flag_name: 'ff_projector_runner_v1', is_enabled: false,
      rollout_percentage: 0, target_environments: [],
    });
    const dispatcher = createDispatcher([]);
    const result = await tickAll({ sb, ctx, dispatcher });
    expect(result.skipped).toBe(true);
    expect(result.perSubscriber).toEqual([]);
  });

  it('returns { skipped: true } when flag is missing', async () => {
    // No insert into feature_flags — isProjectorRunnerEnabled returns false.
    const dispatcher = createDispatcher([]);
    const result = await tickAll({ sb, ctx, dispatcher });
    expect(result.skipped).toBe(true);
  });

  it('runs each registered subscriber when flag is ON', async () => {
    await sb.from('feature_flags').insert({
      flag_name: 'ff_projector_runner_v1', is_enabled: true,
      rollout_percentage: 100, target_environments: [],
    });
    const subA: AnySubscriber = {
      name: 'a', kind: 'learner.mastery_changed', async handle() {},
    };
    const subB: AnySubscriber = {
      name: 'b', kind: 'learner.quiz_completed', async handle() {},
    };
    await sb.from('subscriber_offsets').insert([
      { subscriber_name: 'a', kind_filter: 'learner.mastery_changed', last_processed_occurred_at: '2026-05-12T00:00:00Z' },
      { subscriber_name: 'b', kind_filter: 'learner.quiz_completed', last_processed_occurred_at: '2026-05-12T00:00:00Z' },
    ]);
    await insertEvent(sb, { kind: 'learner.mastery_changed', occurredAt: '2026-05-12T01:00:00Z' });
    await insertEvent(sb, { kind: 'learner.quiz_completed', occurredAt: '2026-05-12T01:00:00Z' });
    const dispatcher = createDispatcher([subA, subB]);
    const result = await tickAll({ sb, ctx, dispatcher });
    expect(result.skipped).toBe(false);
    expect(result.perSubscriber).toHaveLength(2);
    expect(result.perSubscriber.find(r => r.subscriberName === 'a')?.processed).toBe(1);
    expect(result.perSubscriber.find(r => r.subscriberName === 'b')?.processed).toBe(1);
  });

  it('isolates subscribers — one failing does not block the other', async () => {
    await sb.from('feature_flags').insert({
      flag_name: 'ff_projector_runner_v1', is_enabled: true,
      rollout_percentage: 100, target_environments: [],
    });
    const okSub: AnySubscriber = {
      name: 'ok', kind: 'learner.mastery_changed', async handle() {},
    };
    const badSub: AnySubscriber = {
      name: 'bad', kind: 'learner.quiz_completed',
      async handle() { throw new Error('always fails'); },
    };
    await sb.from('subscriber_offsets').insert([
      { subscriber_name: 'ok', kind_filter: 'learner.mastery_changed', last_processed_occurred_at: '2026-05-12T00:00:00Z' },
      { subscriber_name: 'bad', kind_filter: 'learner.quiz_completed', last_processed_occurred_at: '2026-05-12T00:00:00Z' },
    ]);
    await insertEvent(sb, { kind: 'learner.mastery_changed', occurredAt: '2026-05-12T01:00:00Z' });
    await insertEvent(sb, { kind: 'learner.quiz_completed', occurredAt: '2026-05-12T01:00:00Z' });
    const dispatcher = createDispatcher([okSub, badSub]);
    const result = await tickAll({ sb, ctx, dispatcher });
    expect(result.perSubscriber.find(r => r.subscriberName === 'ok')?.processed).toBe(1);
    expect(result.perSubscriber.find(r => r.subscriberName === 'bad')?.processed).toBe(0);
  });
});
