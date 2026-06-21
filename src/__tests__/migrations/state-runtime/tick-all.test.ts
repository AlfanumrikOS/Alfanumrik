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
const SA      = `a-${RUN_ID}`;
const SB_     = `b-${RUN_ID}`;
const SOK     = `ok-${RUN_ID}`;
const SBAD    = `bad-${RUN_ID}`;
const CURSOR  = `2026-05-12T00:00:00.${MS}Z`;
const T1      = `2026-05-12T01:00:00.${MS}Z`;

beforeEach(async () => {
  for (const name of [SA, SB_, SOK, SBAD]) {
    await sb.from('subscriber_offsets').delete().eq('subscriber_name', name);
    await sb.from('subscriber_retry_state').delete().eq('subscriber_name', name);
    await sb.from('subscriber_dead_letters').delete().eq('subscriber_name', name);
  }
  await sb.from('state_events').delete().eq('occurred_at', T1);
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
      name: SA, kind: 'learner.mastery_changed', async handle() {},
    };
    const subB: AnySubscriber = {
      name: SB_, kind: 'learner.quiz_completed', async handle() {},
    };
    await sb.from('subscriber_offsets').insert([
      { subscriber_name: SA,  kind_filter: 'learner.mastery_changed', last_processed_occurred_at: CURSOR },
      { subscriber_name: SB_, kind_filter: 'learner.quiz_completed',  last_processed_occurred_at: CURSOR },
    ]);
    await insertEvent(sb, { kind: 'learner.mastery_changed', occurredAt: T1 });
    await insertEvent(sb, { kind: 'learner.quiz_completed',  occurredAt: T1 });
    const dispatcher = createDispatcher([subA, subB]);
    const result = await tickAll({ sb, ctx, dispatcher });
    expect(result.skipped).toBe(false);
    expect(result.perSubscriber).toHaveLength(2);
    expect(result.perSubscriber.find(r => r.subscriberName === SA)?.processed).toBe(1);
    expect(result.perSubscriber.find(r => r.subscriberName === SB_)?.processed).toBe(1);
  });

  it('isolates subscribers — one failing does not block the other', async () => {
    await sb.from('feature_flags').insert({
      flag_name: 'ff_projector_runner_v1', is_enabled: true,
      rollout_percentage: 100, target_environments: [],
    });
    const okSub: AnySubscriber = {
      name: SOK, kind: 'learner.mastery_changed', async handle() {},
    };
    const badSub: AnySubscriber = {
      name: SBAD, kind: 'learner.quiz_completed',
      async handle() { throw new Error('always fails'); },
    };
    await sb.from('subscriber_offsets').insert([
      { subscriber_name: SOK,  kind_filter: 'learner.mastery_changed', last_processed_occurred_at: CURSOR },
      { subscriber_name: SBAD, kind_filter: 'learner.quiz_completed',  last_processed_occurred_at: CURSOR },
    ]);
    await insertEvent(sb, { kind: 'learner.mastery_changed', occurredAt: T1 });
    await insertEvent(sb, { kind: 'learner.quiz_completed',  occurredAt: T1 });
    const dispatcher = createDispatcher([okSub, badSub]);
    const result = await tickAll({ sb, ctx, dispatcher });
    expect(result.perSubscriber.find(r => r.subscriberName === SOK)?.processed).toBe(1);
    expect(result.perSubscriber.find(r => r.subscriberName === SBAD)?.processed).toBe(0);
  });
});
