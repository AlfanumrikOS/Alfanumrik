import { describe, expect, it } from 'vitest';
import { buildFallbackStudentSnapshot, normalizeStudentSnapshot } from '@alfanumrik/lib/student-snapshot';

/**
 * Honest-data adapter for the student progress snapshot.
 *
 * PROVENANCE: this suite is a relocated, module-scoped replacement for the
 * `experience-v3/student-snapshot-honesty.test.ts` case set that was deleted in
 * the "Alfanumrik One Experience V3" removal (2026-07-15). That test lived under
 * the v3 test directory but actually covered `packages/lib/src/student-snapshot.ts`
 * — a NON-v3 module that SURVIVES the removal and is still LIVE code: it is
 * imported by `packages/lib/src/supabase.ts` (`getStudentSnapshot`), which feeds
 * the legacy student dashboard/progress surfaces. Deleting the v3 test dropped
 * the module's only coverage; this file restores it in the normal lane.
 *
 * Invariant under test: the snapshot NEVER fabricates a zero. Genuine zeros from
 * the data layer are preserved as `0`; missing/failed reads surface as `null`
 * ("unavailable"), and `avg_score` guards against division-by-zero (0 questions
 * asked → `null`, not `0%` and not `NaN`).
 */
describe('student snapshot honest-data adapter', () => {
  it('preserves genuine zero values from the snapshot RPC', () => {
    expect(normalizeStudentSnapshot({
      total_xp: 0,
      current_streak: 0,
      topics_mastered: 0,
      topics_in_progress: 0,
      quizzes_taken: 0,
      avg_score: 0,
    })).toEqual({
      total_xp: 0,
      current_streak: 0,
      topics_mastered: 0,
      topics_in_progress: 0,
      quizzes_taken: 0,
      avg_score: 0,
    });
  });

  it('keeps absent and failed fallback fields unavailable instead of fabricating zero', () => {
    expect(buildFallbackStudentSnapshot({
      profilesResult: { data: null, error: new Error('unavailable') },
      masteredResult: { count: null, error: new Error('unavailable') },
      inProgressResult: { count: null, error: new Error('unavailable') },
      quizzesResult: { count: null, error: new Error('unavailable') },
    })).toEqual({
      total_xp: null,
      current_streak: null,
      topics_mastered: null,
      topics_in_progress: null,
      quizzes_taken: null,
      avg_score: null,
    });
  });

  it('preserves legitimate empty counts while leaving an undefined average unavailable', () => {
    expect(buildFallbackStudentSnapshot({
      profilesResult: { data: [] },
      masteredResult: { count: 0 },
      inProgressResult: { count: 0 },
      quizzesResult: { count: 0 },
    })).toEqual({
      total_xp: 0,
      current_streak: 0,
      topics_mastered: 0,
      topics_in_progress: 0,
      quizzes_taken: 0,
      avg_score: null,
    });
  });
});
