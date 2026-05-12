import { describe, it, expect, beforeEach } from 'vitest';
import { createDispatcher } from '@/lib/state/subscribers/dispatcher';
import type { AnySubscriber } from '@/lib/state/subscribers/subscriber';
import { defaultLog, type SubscriberContext } from '@/lib/state/subscribers/subscriber';
import { makeServiceSupabase, insertEvent } from '../_helpers/supabase-runtime';

const sb = makeServiceSupabase();
const ctx: SubscriberContext = { sb, dryRun: false, now: () => new Date(), log: defaultLog };

beforeEach(async () => {
  await sb.from('state_events').delete().eq('kind', 'learner.mastery_changed');
  await sb.from('subscriber_offsets').delete().in('subscriber_name', ['no-scope', 'replayable']);
});

describe('replayForStudent', () => {
  it('refuses for a subscriber without studentIdFromEvent', async () => {
    const sub: AnySubscriber = {
      name: 'no-scope', kind: 'learner.mastery_changed',
      async handle() {},
    };
    const dispatcher = createDispatcher([sub]);
    const r = await dispatcher.replayForStudent('no-scope', 'auth-user-X', ctx);
    expect(r).toEqual({ refused: 'not_student_scoped' });
  });

  it('throws for an unknown subscriber name', async () => {
    const dispatcher = createDispatcher([]);
    await expect(
      dispatcher.replayForStudent('ghost', 'auth-user-X', ctx),
    ).rejects.toThrow(/unknown subscriber/i);
  });

  it('re-invokes handler for matching events; does not mutate offset', async () => {
    const calls: string[] = [];
    const sub: AnySubscriber = {
      name: 'replayable',
      kind: 'learner.mastery_changed',
      studentIdFromEvent: (e) => e.actorAuthUserId,
      async handle(e) { calls.push(e.eventId); },
    };
    await sb.from('subscriber_offsets').insert({
      subscriber_name: 'replayable',
      kind_filter: 'learner.mastery_changed',
      last_processed_occurred_at: '2026-05-12T05:00:00Z',
    });
    await insertEvent(sb, { kind: 'learner.mastery_changed', actorAuthUserId: '00000000-0000-0000-0000-000000000001', occurredAt: '2026-05-12T01:00:00Z' });
    await insertEvent(sb, { kind: 'learner.mastery_changed', actorAuthUserId: '00000000-0000-0000-0000-000000000002', occurredAt: '2026-05-12T02:00:00Z' });
    await insertEvent(sb, { kind: 'learner.mastery_changed', actorAuthUserId: '00000000-0000-0000-0000-000000000001', occurredAt: '2026-05-12T03:00:00Z' });

    const dispatcher = createDispatcher([sub]);
    const r = await dispatcher.replayForStudent('replayable', '00000000-0000-0000-0000-000000000001', ctx);
    expect(r).toMatchObject({ replayed: 2, errors: [] });
    expect(calls.length).toBe(2);

    // Offset untouched.
    const { data: off } = await sb.from('subscriber_offsets')
      .select('last_processed_occurred_at').eq('subscriber_name', 'replayable').single();
    expect(off?.last_processed_occurred_at?.startsWith('2026-05-12T05:00:00')).toBe(true);
  });
});
