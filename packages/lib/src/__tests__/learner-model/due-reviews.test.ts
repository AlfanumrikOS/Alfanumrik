/**
 * Learner-model facade — getDueReviews (mocked client).
 *
 * Pins: RPC args, row mapping (6-col RPC contract + display fields), the F7
 * additive SM-2 merge from concept_mastery, non-fatal merge failure, and the
 * fail-soft [] on RPC error.
 */

import { describe, it, expect, vi } from 'vitest';
import { getDueReviews } from '@alfanumrik/lib/learner-model';
import { dueReviewsToCards } from '@alfanumrik/lib/learn/due-reviews-adapter';

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

type Result = { data: unknown; error: { message: string } | null };

/** Minimal thenable query-builder mock for `.from().select().eq().in()`. */
function makeFromChain(result: Result) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in']) {
    chain[m] = vi.fn(() => chain);
  }
  (chain as { then: unknown }).then = (
    resolve: (r: Result) => unknown,
    reject?: (e: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

function makeClient(opts: {
  rpcResult: Result;
  sm2Result?: Result;
}) {
  const fromChain = makeFromChain(opts.sm2Result ?? { data: [], error: null });
  const rpc = vi.fn(async () => opts.rpcResult);
  const from = vi.fn(() => fromChain);
  return {
    client: { rpc, from } as never,
    rpc,
    from,
    fromChain,
  };
}

const RPC_ROWS = [
  {
    topic_id: 't1',
    title: 'Fractions',
    title_hi: 'भिन्न',
    mastery_probability: 0.35,
    last_attempted_at: '2026-07-01T00:00:00.000Z',
    review_interval_days: 6,
  },
  {
    topic_id: 't2',
    title: '',
    title_hi: null,
    subject_code: 'MATH',
    mastery_probability: null,
    last_attempted_at: null,
    review_interval_days: 1,
  },
  { topic_id: '', title: 'ghost' }, // dropped: empty topic_id
];

describe('learner-model getDueReviews', () => {
  it('calls the RPC with the frozen arg names and maps the rows', async () => {
    const { client, rpc } = makeClient({
      rpcResult: { data: RPC_ROWS, error: null },
    });
    const rows = await getDueReviews(client, 'student-1', 'sci', 7);
    expect(rpc).toHaveBeenCalledWith('get_due_reviews', {
      p_student_id: 'student-1',
      p_subject_code: 'sci',
      p_limit: 7,
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      topic_id: 't1',
      title: 'Fractions',
      title_hi: 'भिन्न',
      mastery_probability: 0.35,
      review_interval_days: 6,
    });
    // subject passthrough is best-effort: present when the RPC surfaces it.
    expect(rows[1].subject_code).toBe('MATH');
    expect(rows[1].mastery_probability).toBeNull();
  });

  it('defaults: subjectCode null, limit 20', async () => {
    const { client, rpc } = makeClient({ rpcResult: { data: [], error: null } });
    await getDueReviews(client, 'student-1');
    expect(rpc).toHaveBeenCalledWith('get_due_reviews', {
      p_student_id: 'student-1',
      p_subject_code: null,
      p_limit: 20,
    });
  });

  it('F7: merges ease_factor + next_review_at from concept_mastery onto the rows', async () => {
    const { client, from, fromChain } = makeClient({
      rpcResult: { data: RPC_ROWS, error: null },
      sm2Result: {
        data: [
          { topic_id: 't1', ease_factor: 2.7, next_review_at: '2026-08-01T00:00:00.000Z' },
        ],
        error: null,
      },
    });
    const rows = await getDueReviews(client, 'student-1');
    expect(from).toHaveBeenCalledWith('concept_mastery');
    expect(fromChain.in).toHaveBeenCalledWith('topic_id', ['t1', 't2']);
    expect(rows[0].ease_factor).toBe(2.7);
    expect(rows[0].next_review_at).toBe('2026-08-01T00:00:00.000Z');
    // t2 had no merge row: fields stay absent → adapter defaults apply.
    expect(rows[1].ease_factor).toBeUndefined();

    // The rows feed the adapter directly (structural superset of its input).
    const cards = dueReviewsToCards({
      rows,
      conceptToQuestion: new Map([
        ['t1', 'q1'],
        ['t2', 'q2'],
      ]),
      aheadOfGradeConceptIds: new Set(),
    });
    expect(cards[0].easeFactor).toBe(2.7); // merged value carried through
    expect(cards[1].easeFactor).toBe(2.5); // adapter documented default
  });

  it('SM-2 merge failure is NON-FATAL: rows still returned without the fields', async () => {
    const { client } = makeClient({
      rpcResult: { data: RPC_ROWS, error: null },
      sm2Result: { data: null, error: null },
    });
    // Make the from() chain throw instead.
    (client as { from: unknown }).from = vi.fn(() => {
      throw new Error('boom');
    });
    const rows = await getDueReviews(client, 'student-1');
    expect(rows).toHaveLength(2);
    expect(rows[0].ease_factor).toBeUndefined();
  });

  it('fail-soft: RPC error → []', async () => {
    const { client } = makeClient({
      rpcResult: { data: null, error: { message: 'rpc down' } },
    });
    expect(await getDueReviews(client, 'student-1')).toEqual([]);
  });

  it('fail-soft: RPC throw → []', async () => {
    const client = {
      rpc: vi.fn(async () => {
        throw new Error('network');
      }),
      from: vi.fn(),
    } as never;
    expect(await getDueReviews(client, 'student-1')).toEqual([]);
  });
});
