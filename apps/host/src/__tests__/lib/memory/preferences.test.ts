/**
 * Unified Student Memory — preferences slice unit tests (GenAI arch Phase 2).
 *
 * `loadStudentPreferences` reads learning_style + preferred_explanation_depth
 * from `student_learning_profiles` (advisory HOW-to-explain hints only — never
 * WHAT-is-mastered). It is best-effort: any error / missing row / thrown
 * exception → EMPTY_PREFERENCES (both null). Never invents a value.
 *
 * Hermetic: a fake query builder returns a canned maybeSingle() result.
 */
import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  loadStudentPreferences,
  EMPTY_PREFERENCES,
} from '@alfanumrik/lib/memory/preferences';

type Row = { learning_style: string | null; preferred_explanation_depth: string | null };
type Result = { data: Row | null; error: { message: string } | null };

interface Calls {
  from: string[];
  select: string[];
  eq: Array<[string, unknown]>;
  order: Array<[string, { ascending: boolean }]>;
}

function makeSb(
  result: Result,
  opts: { throwOnFrom?: boolean } = {},
): { sb: SupabaseClient; calls: Calls } {
  const calls: Calls = { from: [], select: [], eq: [], order: [] };
  const builder: Record<string, unknown> = {
    select(cols: string) {
      calls.select.push(cols);
      return builder;
    },
    eq(k: string, v: unknown) {
      calls.eq.push([k, v]);
      return builder;
    },
    order(col: string, opts2: { ascending: boolean }) {
      calls.order.push([col, opts2]);
      return builder;
    },
    limit() {
      return builder;
    },
    maybeSingle() {
      return Promise.resolve(result);
    },
  };
  const sb = {
    from(table: string) {
      calls.from.push(table);
      if (opts.throwOnFrom) throw new Error('boom');
      return builder;
    },
  } as unknown as SupabaseClient;
  return { sb, calls };
}

const STUDENT_ID = 'student-xyz';

describe('loadStudentPreferences', () => {
  it('maps both columns from the row', async () => {
    const { sb, calls } = makeSb({
      data: { learning_style: 'visual', preferred_explanation_depth: 'deep' },
      error: null,
    });
    const prefs = await loadStudentPreferences(STUDENT_ID, sb);
    expect(prefs).toEqual({ learningStyle: 'visual', preferredExplanationDepth: 'deep' });
    // reads the right table, keyed by student_id
    expect(calls.from).toEqual(['student_learning_profiles']);
    expect(calls.eq).toContainEqual(['student_id', STUDENT_ID]);
    // deterministic row pick: newest by updated_at, id as unique tiebreak
    expect(calls.order).toEqual([
      ['updated_at', { ascending: false }],
      ['id', { ascending: false }],
    ]);
  });

  it('applies a subject filter only when the subject arg is provided', async () => {
    // with subject → adds an eq('subject', ...) filter on top of student_id
    const scoped = makeSb({
      data: { learning_style: 'visual', preferred_explanation_depth: 'deep' },
      error: null,
    });
    await loadStudentPreferences(STUDENT_ID, scoped.sb, 'mathematics');
    expect(scoped.calls.eq).toContainEqual(['student_id', STUDENT_ID]);
    expect(scoped.calls.eq).toContainEqual(['subject', 'mathematics']);
    // ordering determinism holds regardless of subject scoping
    expect(scoped.calls.order).toEqual([
      ['updated_at', { ascending: false }],
      ['id', { ascending: false }],
    ]);

    // without subject → no subject filter, only the student_id key
    const unscoped = makeSb({
      data: { learning_style: 'visual', preferred_explanation_depth: 'deep' },
      error: null,
    });
    await loadStudentPreferences(STUDENT_ID, unscoped.sb);
    expect(unscoped.calls.eq).toEqual([['student_id', STUDENT_ID]]);
    expect(unscoped.calls.eq).not.toContainEqual(['subject', expect.anything()]);
  });

  it('coerces missing column values to null (never invents)', async () => {
    const { sb } = makeSb({
      data: { learning_style: null, preferred_explanation_depth: null },
      error: null,
    });
    const prefs = await loadStudentPreferences(STUDENT_ID, sb);
    expect(prefs).toEqual(EMPTY_PREFERENCES);
    expect(prefs.learningStyle).toBeNull();
    expect(prefs.preferredExplanationDepth).toBeNull();
  });

  it('returns EMPTY_PREFERENCES when the row is absent (null data)', async () => {
    const { sb } = makeSb({ data: null, error: null });
    await expect(loadStudentPreferences(STUDENT_ID, sb)).resolves.toEqual(EMPTY_PREFERENCES);
  });

  it('returns EMPTY_PREFERENCES on a query error', async () => {
    const { sb } = makeSb({ data: null, error: { message: 'boom' } });
    await expect(loadStudentPreferences(STUDENT_ID, sb)).resolves.toEqual(EMPTY_PREFERENCES);
  });

  it('returns EMPTY_PREFERENCES (fail-soft) when the client throws', async () => {
    const { sb } = makeSb({ data: null, error: null }, { throwOnFrom: true });
    await expect(loadStudentPreferences(STUDENT_ID, sb)).resolves.toEqual(EMPTY_PREFERENCES);
  });
});
