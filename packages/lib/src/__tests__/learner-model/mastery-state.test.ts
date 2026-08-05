/**
 * Learner-model facade — getMasteryState (mocked client).
 *
 * Pins: query construction (student scope, topicIds, masteryBelow, order,
 * limit), row → MasteryState mapping (join normalization: object AND array
 * shapes), CLIENT-SIDE subjectId filtering, and the fail-soft [].
 */

import { describe, it, expect, vi } from 'vitest';
import { getMasteryState } from '@alfanumrik/lib/learner-model';

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

type Result = { data: unknown; error: { message: string } | null };

function makeClient(result: Result) {
  const calls: Record<string, unknown[][]> = {};
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'lt', 'order']) {
    calls[m] = [];
    chain[m] = vi.fn((...args: unknown[]) => {
      calls[m].push(args);
      return chain;
    });
  }
  calls.limit = [];
  chain.limit = vi.fn(async (...args: unknown[]) => {
    calls.limit.push(args);
    return result;
  });
  const from = vi.fn(() => chain);
  return { client: { from, rpc: vi.fn() } as never, from, calls };
}

const ROWS = [
  {
    topic_id: 't1',
    mastery_probability: 0.42,
    mastery_level: 'developing',
    attempts: 7,
    correct_attempts: 4,
    hints_used: 2,
    ease_factor: 2.6,
    review_interval_days: 6,
    next_review_at: '2026-08-10T00:00:00.000Z',
    last_attempted_at: '2026-08-01T00:00:00.000Z',
    retention_half_life: 96,
    current_retention: 0.42,
    streak_current: 1,
    consecutive_wrong: 0,
    consecutive_correct: 1,
    updated_at: '2026-08-01T00:00:00.000Z',
    curriculum_topics: { title: 'Fractions', subject_id: 'subj-math' },
  },
  {
    topic_id: 't2',
    mastery_probability: null,
    mastery_level: null,
    attempts: null,
    correct_attempts: null,
    hints_used: null,
    ease_factor: null,
    review_interval_days: null,
    next_review_at: null,
    last_attempted_at: null,
    retention_half_life: null,
    current_retention: null,
    streak_current: null,
    consecutive_wrong: null,
    consecutive_correct: null,
    updated_at: null,
    // join returned as ARRAY (PostgREST ambiguity shape) — must normalize
    curriculum_topics: [{ title: 'Cells', subject_id: 'subj-sci' }],
  },
  { topic_id: '', curriculum_topics: null }, // dropped: empty topic_id
];

describe('learner-model getMasteryState', () => {
  it('reads concept_mastery scoped to the student, weakest-first by default', async () => {
    const { client, from, calls } = makeClient({ data: ROWS, error: null });
    const states = await getMasteryState(client, 'student-1');
    expect(from).toHaveBeenCalledWith('concept_mastery');
    expect(calls.eq[0]).toEqual(['student_id', 'student-1']);
    expect(calls.order[0]).toEqual(['mastery_probability', { ascending: true }]);
    expect(calls.limit[0]).toEqual([200]);
    expect(calls.in).toEqual([]); // no topicIds filter by default
    expect(calls.lt).toEqual([]); // no masteryBelow filter by default

    expect(states).toHaveLength(2);
    expect(states[0]).toMatchObject({
      topicId: 't1',
      title: 'Fractions',
      subjectId: 'subj-math',
      masteryProbability: 0.42,
      masteryLevel: 'developing',
      attempts: 7,
      correctAttempts: 4,
      hintsUsed: 2,
      easeFactor: 2.6,
      nextReviewAt: '2026-08-10T00:00:00.000Z',
      currentRetention: 0.42,
      consecutiveCorrect: 1,
    });
    // Array-shaped join normalized; null numerics preserved as null,
    // attempts/correct coerced to 0.
    expect(states[1]).toMatchObject({
      topicId: 't2',
      title: 'Cells',
      subjectId: 'subj-sci',
      masteryProbability: null,
      attempts: 0,
      correctAttempts: 0,
      hintsUsed: null,
    });
  });

  it('applies topicIds, masteryBelow, updated_desc order, and limit', async () => {
    const { client, calls } = makeClient({ data: [], error: null });
    await getMasteryState(client, 'student-1', {
      topicIds: ['t1', 't2'],
      masteryBelow: 0.5,
      orderBy: 'updated_desc',
      limit: 8,
    });
    expect(calls.in[0]).toEqual(['topic_id', ['t1', 't2']]);
    expect(calls.lt[0]).toEqual(['mastery_probability', 0.5]);
    expect(calls.order[0]).toEqual(['updated_at', { ascending: false }]);
    expect(calls.limit[0]).toEqual([8]);
  });

  it('filters by subjectId CLIENT-SIDE via the join', async () => {
    const { client } = makeClient({ data: ROWS, error: null });
    const states = await getMasteryState(client, 'student-1', {
      subjectId: 'subj-math',
    });
    expect(states).toHaveLength(1);
    expect(states[0].topicId).toBe('t1');
  });

  it('fail-soft: DB error → []', async () => {
    const { client } = makeClient({ data: null, error: { message: 'down' } });
    expect(await getMasteryState(client, 'student-1')).toEqual([]);
  });

  it('fail-soft: thrown error → []', async () => {
    const client = {
      from: vi.fn(() => {
        throw new Error('boom');
      }),
      rpc: vi.fn(),
    } as never;
    expect(await getMasteryState(client, 'student-1')).toEqual([]);
  });
});
