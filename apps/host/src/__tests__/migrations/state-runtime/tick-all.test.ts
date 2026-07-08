import { describe, it, expect, beforeEach } from 'vitest';
import { tickAll } from '@alfanumrik/lib/state/runtime/tick-all';
import { __resetFlagCacheForTests } from '@alfanumrik/lib/state/runtime/flag';
import { createDispatcher } from '@alfanumrik/lib/state/subscribers/dispatcher';
import type { AnySubscriber } from '@alfanumrik/lib/state/subscribers/subscriber';
import { defaultLog, type SubscriberContext } from '@alfanumrik/lib/state/subscribers/subscriber';
import {
  makeServiceSupabase,
  insertEvent,
  hasIsolatedStateRuntimeDb,
} from '../_helpers/supabase-runtime';

// Count-sensitive tests below assert exact per-tick processed/dead-letter
// counts. The projector reads state_events open-ended upward from the cursor
// (no actor scoping — see tick-one.ts), so on a SHARED CI DB foreign runs'
// events inflate those counts (the `expected 4 to be 3` / `47 to be 1` false-
// reds). They run fully on an isolated DB and SKIP on the shared CI DB. The
// kill-switch tests (flag OFF / missing) use an empty dispatcher and are
// pollution-immune, so they always run. See hasIsolatedStateRuntimeDb() for the
// follow-up to make this permanent.
const itIsolated = hasIsolatedStateRuntimeDb() ? it : it.skip;

const sb = makeServiceSupabase();
const ctx: SubscriberContext = { sb, dryRun: false, now: () => new Date(), log: defaultLog };

// Each run tags its events with a unique RUN_ACTOR_ID (a per-run UUID). beforeEach
// (a) deletes only OUR events by RUN_ACTOR_ID — safe against concurrent runs, and
// (b) deletes OLD events with the default actor-ID in our range — handles accumulated
// past-run contamination without touching concurrent runs (they use their own IDs).
const RUN_ID       = crypto.randomUUID().replace(/-/g, '');
const RUN_ACTOR_ID = crypto.randomUUID();                // unique per-run event tag
const OFFSET_SEC   = parseInt(RUN_ID.slice(0, 8), 16);  // 0..4294967295 ≈ 136-year spread
const FUTURE       = Date.now() + 365 * 24 * 3600_000 + OFFSET_SEC * 1000;
const CURSOR       = new Date(FUTURE - 1000).toISOString();   // 1 s before T1
const T1           = new Date(FUTURE).toISOString();

const RUN_SUFFIX = RUN_ID.slice(0, 6);
const SA         = `a-${RUN_SUFFIX}`;
const SB_        = `b-${RUN_SUFFIX}`;
const SOK        = `ok-${RUN_SUFFIX}`;
const SBAD       = `bad-${RUN_SUFFIX}`;

beforeEach(async () => {
  for (const name of [SA, SB_, SOK, SBAD]) {
    await sb.from('subscriber_offsets').delete().eq('subscriber_name', name);
    await sb.from('subscriber_retry_state').delete().eq('subscriber_name', name);
    await sb.from('subscriber_dead_letters').delete().eq('subscriber_name', name);
  }
  // (a) Delete our own events from the previous test — safe: other runs have different RUN_ACTOR_IDs.
  await sb.from('state_events').delete().eq('actor_auth_user_id', RUN_ACTOR_ID);
  // (b) Delete accumulated past-run events (old runs used the default zero UUID) in our range.
  await sb.from('state_events').delete()
    .eq('actor_auth_user_id', '00000000-0000-0000-0000-000000000000')
    .in('kind', ['learner.mastery_changed', 'learner.quiz_completed'])
    .gte('occurred_at', CURSOR);
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

  itIsolated('runs each registered subscriber when flag is ON', async () => {
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
    await insertEvent(sb, { kind: 'learner.mastery_changed', occurredAt: T1, actorAuthUserId: RUN_ACTOR_ID });
    await insertEvent(sb, { kind: 'learner.quiz_completed', occurredAt: T1, actorAuthUserId: RUN_ACTOR_ID });
    const dispatcher = createDispatcher([subA, subB]);
    const result = await tickAll({ sb, ctx, dispatcher });
    expect(result.skipped).toBe(false);
    expect(result.perSubscriber).toHaveLength(2);
    expect(result.perSubscriber.find(r => r.subscriberName === SA)?.processed).toBe(1);
    expect(result.perSubscriber.find(r => r.subscriberName === SB_)?.processed).toBe(1);
  });

  itIsolated('isolates subscribers — one failing does not block the other', async () => {
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
    await insertEvent(sb, { kind: 'learner.mastery_changed', occurredAt: T1, actorAuthUserId: RUN_ACTOR_ID });
    await insertEvent(sb, { kind: 'learner.quiz_completed', occurredAt: T1, actorAuthUserId: RUN_ACTOR_ID });
    const dispatcher = createDispatcher([okSub, badSub]);
    const result = await tickAll({ sb, ctx, dispatcher });
    expect(result.perSubscriber.find(r => r.subscriberName === SOK)?.processed).toBe(1);
    expect(result.perSubscriber.find(r => r.subscriberName === SBAD)?.processed).toBe(0);
  });
});
