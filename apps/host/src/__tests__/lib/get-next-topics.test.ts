/**
 * Tests for `getNextTopics` — covers the silent-fallback bug fixed in the
 * `fix(data): coerce preferred_subject` PR. The matching subjects.code
 * resolves correctly; an unmatched value triggers the warn-log (so the
 * same kind of drift surfaces in Sentry/server logs next time).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoisted Supabase client mock — getNextTopics uses the module-level
// `supabase` singleton. We replace `from` so we can drive the response
// for both subjects and curriculum_topics in one test.
const fromMock = vi.hoisted(() => vi.fn());
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: fromMock }),
}));

// Set up env so the module-level supabase singleton can construct.
beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon_key_placeholder';
  fromMock.mockReset();
});

// Restore console spies between tests — otherwise a spy from one test
// leaks call counts into the next (vi.spyOn doesn't auto-restore).
afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Build a query-chain stub that returns `data` from the final terminal
 * call (`.single()` for subjects, awaiting the query for curriculum_topics).
 * The chain methods all return `this` so they can be chained arbitrarily.
 */
function makeChain(terminal: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  const passthroughMethods = ['select', 'eq', 'order', 'limit'] as const;
  for (const m of passthroughMethods) {
    chain[m] = vi.fn(() => chain);
  }
  chain.single = vi.fn().mockResolvedValue(terminal);
  // For the curriculum_topics path the function awaits the chain itself
  // (no `.single()`) — Supabase returns a thenable, so make this stub
  // resolve to `terminal` when awaited.
  (chain as any).then = (onFulfilled: (v: unknown) => unknown) =>
    Promise.resolve(terminal).then(onFulfilled);
  return chain;
}

describe('getNextTopics — silent-fallback bug fix (preferred_subject)', () => {
  it('happy path: subject="math" resolves to a subjects.code row and applies the filter', async () => {
    const topicsChain = makeChain({
      data: [
        { id: 't1', title: 'Number Systems', chapter_number: 1, display_order: 1, grade: '9' },
      ],
      error: null,
    });
    fromMock.mockImplementation((table: string) => {
      if (table === 'curriculum_topics') return topicsChain;
      if (table === 'subjects') {
        return makeChain({ data: { id: 'math-subject-uuid' }, error: null });
      }
      throw new Error(`unexpected table: ${table}`);
    });

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { getNextTopics } = await import('@alfanumrik/lib/supabase');
    const out = await getNextTopics('student-1', 'math', '9');

    expect(out).toEqual([
      { id: 't1', title: 'Number Systems', chapter_number: 1, display_order: 1, grade: '9' },
    ]);
    expect(warn).not.toHaveBeenCalled();

    // Verify the subject_id filter was applied
    expect(topicsChain.eq).toHaveBeenCalledWith('subject_id', 'math-subject-uuid');
  });

  it('drift path: subject="Mathematics" does not resolve, warn-logs with context, filter dropped', async () => {
    const topicsChain = makeChain({ data: [], error: null });
    fromMock.mockImplementation((table: string) => {
      if (table === 'curriculum_topics') return topicsChain;
      if (table === 'subjects') {
        // Supabase returns { data: null } when .eq().single() finds no row.
        return makeChain({ data: null, error: { message: 'no rows', code: 'PGRST116' } });
      }
      throw new Error(`unexpected table: ${table}`);
    });

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { getNextTopics } = await import('@alfanumrik/lib/supabase');
    await getNextTopics('student-7', 'Mathematics', '9');

    expect(warn).toHaveBeenCalledTimes(1);
    const [msg, ctx] = warn.mock.calls[0];
    expect(msg).toContain('preferred_subject did not resolve');
    expect(ctx).toEqual({ studentId: 'student-7', subject: 'Mathematics', grade: '9' });

    // Filter MUST NOT be applied when subject doesn't resolve — verifies
    // we kept the existing fallback behavior (just with a warn now).
    const subjectIdCalls = (topicsChain.eq as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => c[0] === 'subject_id',
    );
    expect(subjectIdCalls).toHaveLength(0);
  });

  it('no subject argument: no subject lookup, no warn-log', async () => {
    const topicsChain = makeChain({ data: [], error: null });
    fromMock.mockImplementation((table: string) => {
      if (table === 'curriculum_topics') return topicsChain;
      throw new Error(`unexpected table: ${table}`);
    });

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { getNextTopics } = await import('@alfanumrik/lib/supabase');
    await getNextTopics('student-1', null, '9');

    expect(warn).not.toHaveBeenCalled();
    // subjects table not consulted at all when subject is null/undefined.
    const subjectCalls = fromMock.mock.calls.filter((c) => c[0] === 'subjects');
    expect(subjectCalls).toHaveLength(0);
  });
});
