import { describe, it, expect, beforeEach } from 'vitest';
import { tickAll } from '@/lib/state/runtime/tick-all';
import { __resetFlagCacheForTests } from '@/lib/state/runtime/flag';
import { createDispatcher } from '@/lib/state/subscribers/dispatcher';
import type { AnySubscriber } from '@/lib/state/subscribers/subscriber';
import { defaultLog, type SubscriberContext } from '@/lib/state/subscribers/subscriber';
import {
  makeServiceSupabase,
  insertEvent,
  hasIsolatedStateRuntimeDb,
} from '../_helpers/supabase-runtime';

// This whole test asserts EXACT per-tick processed / retry / dead-letter counts.
// The projector reads state_events open-ended upward from the cursor (no actor
// scoping — see tick-one.ts), so on a SHARED CI DB foreign runs' events inflate
// those counts (the `expected 4 to be 3` / `47 to be 1` false-reds). It runs
// fully on an isolated DB and SKIPS on the shared CI DB. See
// hasIsolatedStateRuntimeDb() for the follow-up to make this permanent.
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
const T2           = new Date(FUTURE + 1000).toISOString();   // T1 + 1 s

const RUN_SUFFIX = RUN_ID.slice(0, 6);
const SOK        = `ok-${RUN_SUFFIX}`;
const SBAD       = `bad-${RUN_SUFFIX}`;

beforeEach(async () => {
  for (const name of [SOK, SBAD]) {
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
  await sb.from('feature_flags').insert({
    flag_name: 'ff_projector_runner_v1', is_enabled: true,
    rollout_percentage: 100, target_environments: [],
  });
});

describe('integration: tickAll with two subscribers across 3 ticks', () => {
  itIsolated('failing subscriber dead-letters its bad event after 3 ticks; good subscriber unaffected', async () => {
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

    const bad = await insertEvent(sb, { kind: 'learner.quiz_completed', occurredAt: T1, actorAuthUserId: RUN_ACTOR_ID });
    await insertEvent(sb, { kind: 'learner.mastery_changed', occurredAt: T1, actorAuthUserId: RUN_ACTOR_ID });
    await insertEvent(sb, { kind: 'learner.mastery_changed', occurredAt: T2, actorAuthUserId: RUN_ACTOR_ID });

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
    expect(badOffset?.last_processed_occurred_at?.startsWith(T1.slice(0, 19))).toBe(true);
    expect(badOffset?.events_dead_lettered).toBe(1);

    // ok subscriber processed both its events on tick 1; nothing on ticks 2/3.
    expect(okCalls.length).toBe(2);
    const { data: okOffset } = await sb.from('subscriber_offsets')
      .select('last_processed_occurred_at, events_processed')
      .eq('subscriber_name', SOK).single();
    expect(okOffset?.last_processed_occurred_at?.startsWith(T2.slice(0, 19))).toBe(true);
    expect(okOffset?.events_processed).toBe(2);
  });
});
