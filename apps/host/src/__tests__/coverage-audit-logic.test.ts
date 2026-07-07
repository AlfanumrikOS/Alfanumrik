/**
 * coverage-audit — pure logic tests.
 *
 * Covers the decision logic exported from
 * supabase/functions/coverage-audit/shared.ts:
 *   - summarizeSnapshot
 *   - detectRegressions (yesterday → today transitions)
 *   - computeVerifiedRatios (aggregation by grade+subject)
 *   - pairsToAutoDisable (threshold application)
 *
 * Side-effectful parts (RPC calls, upserts, ops_events) are integration
 * concerns exercised in staging / manual run.
 */

import { describe, it, expect } from 'vitest';
import {
  AUTO_DISABLE_RATIO_THRESHOLD,
  computeVerifiedRatios,
  detectRegressions,
  pairsToAutoDisable,
  summarizeSnapshot,
  type EnforcedPair,
  type SyllabusRow,
  type ChapterStats,
} from '../../supabase/functions/coverage-audit/shared';

function row(
  grade: string,
  subject: string,
  chapter: number,
  status: 'missing' | 'partial' | 'ready',
  chunks = 0,
  vq = 0,
): SyllabusRow {
  return {
    board: 'CBSE',
    grade,
    subject_code: subject,
    chapter_number: chapter,
    rag_status: status,
    chunk_count: chunks,
    verified_question_count: vq,
  };
}

describe('coverage-audit / summarizeSnapshot', () => {
  it('counts each status correctly', () => {
    const rows = [
      row('10', 'science', 1, 'ready', 50, 40),
      row('10', 'science', 2, 'partial', 20, 10),
      row('10', 'science', 3, 'missing', 0, 0),
      row('10', 'science', 4, 'ready', 80, 60),
    ];
    const s = summarizeSnapshot(rows);
    expect(s.ready_count).toBe(2);
    expect(s.partial_count).toBe(1);
    expect(s.missing_count).toBe(1);
    expect(s.total_chunks).toBe(150);
    expect(s.total_verified_questions).toBe(110);
  });

  it('empty snapshot returns all zeros', () => {
    const s = summarizeSnapshot([]);
    expect(s).toEqual({
      ready_count: 0,
      partial_count: 0,
      missing_count: 0,
      total_verified_questions: 0,
      total_chunks: 0,
    });
  });

  it('treats missing chunk_count/vq fields as 0', () => {
    const s = summarizeSnapshot([{
      board: 'CBSE', grade: '10', subject_code: 'science', chapter_number: 1, rag_status: 'ready',
    }]);
    expect(s.total_chunks).toBe(0);
    expect(s.total_verified_questions).toBe(0);
  });
});

describe('coverage-audit / detectRegressions', () => {
  it('flags ready → partial as a regression', () => {
    const y = [row('10', 'science', 1, 'ready')];
    const t = [row('10', 'science', 1, 'partial')];
    const regs = detectRegressions(y, t);
    expect(regs).toHaveLength(1);
    expect(regs[0]).toMatchObject({
      grade: '10', subject_code: 'science', chapter_number: 1,
      previous_status: 'ready', current_status: 'partial',
    });
  });

  it('flags ready → missing as a regression', () => {
    const y = [row('10', 'science', 1, 'ready')];
    const t = [row('10', 'science', 1, 'missing')];
    expect(detectRegressions(y, t)).toHaveLength(1);
  });

  it('flags partial → missing as a regression', () => {
    const y = [row('10', 'science', 1, 'partial')];
    const t = [row('10', 'science', 1, 'missing')];
    expect(detectRegressions(y, t)).toHaveLength(1);
  });

  it('does NOT flag partial → ready (improvement)', () => {
    const y = [row('10', 'science', 1, 'partial')];
    const t = [row('10', 'science', 1, 'ready')];
    expect(detectRegressions(y, t)).toEqual([]);
  });

  it('does NOT flag missing → partial (improvement)', () => {
    const y = [row('10', 'science', 1, 'missing')];
    const t = [row('10', 'science', 1, 'partial')];
    expect(detectRegressions(y, t)).toEqual([]);
  });

  it('does NOT flag unchanged rows', () => {
    const y = [row('10', 'science', 1, 'ready')];
    const t = [row('10', 'science', 1, 'ready')];
    expect(detectRegressions(y, t)).toEqual([]);
  });

  it('ignores rows present only today (new chapters cannot regress)', () => {
    const y: SyllabusRow[] = [];
    const t = [row('10', 'science', 99, 'missing')];
    expect(detectRegressions(y, t)).toEqual([]);
  });

  it('detects regressions per-(board, grade, subject, chapter)', () => {
    const y = [
      row('10', 'science', 1, 'ready'),
      row('10', 'science', 2, 'ready'),
      row('10', 'math', 1, 'ready'),
    ];
    const t = [
      row('10', 'science', 1, 'partial'),  // regression
      row('10', 'science', 2, 'ready'),    // unchanged
      row('10', 'math', 1, 'ready'),       // unchanged
    ];
    const regs = detectRegressions(y, t);
    expect(regs).toHaveLength(1);
    expect(regs[0].subject_code).toBe('science');
    expect(regs[0].chapter_number).toBe(1);
  });
});

describe('coverage-audit / computeVerifiedRatios', () => {
  it('aggregates by grade+subject across chapters', () => {
    const stats: ChapterStats[] = [
      { grade: '10', subject_code: 'science', chapter_number: 1, verified_question_count: 50, total_questions: 50 },
      { grade: '10', subject_code: 'science', chapter_number: 2, verified_question_count: 30, total_questions: 50 },
    ];
    const r = computeVerifiedRatios(stats);
    expect(r['10::science']).toBe(0.8);
  });

  it('returns 1 for a pair with zero total questions (cold start)', () => {
    const stats: ChapterStats[] = [
      { grade: '10', subject_code: 'science', chapter_number: 1, verified_question_count: 0, total_questions: 0 },
    ];
    expect(computeVerifiedRatios(stats)['10::science']).toBe(1);
  });

  it('keeps distinct pairs separate', () => {
    const stats: ChapterStats[] = [
      { grade: '10', subject_code: 'science', chapter_number: 1, verified_question_count: 10, total_questions: 20 },
      { grade: '10', subject_code: 'math', chapter_number: 1, verified_question_count: 40, total_questions: 40 },
    ];
    const r = computeVerifiedRatios(stats);
    expect(r['10::science']).toBe(0.5);
    expect(r['10::math']).toBe(1);
  });
});

describe('coverage-audit / pairsToAutoDisable', () => {
  const threshold = AUTO_DISABLE_RATIO_THRESHOLD; // 0.85

  it('auto-disables a pair whose ratio is 0.80 (< 0.85)', () => {
    const enforced: EnforcedPair[] = [{ grade: '10', subject_code: 'science', enabled: true }];
    const ratios = { '10::science': 0.80 };
    const out = pairsToAutoDisable(enforced, ratios);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ grade: '10', subject_code: 'science' });
    expect(out[0].verified_ratio).toBe(0.80);
  });

  it('does NOT auto-disable when ratio exactly equals threshold (boundary = stay enabled)', () => {
    const enforced: EnforcedPair[] = [{ grade: '10', subject_code: 'science', enabled: true }];
    const ratios = { '10::science': threshold };
    expect(pairsToAutoDisable(enforced, ratios)).toEqual([]);
  });

  it('does NOT auto-disable when ratio is above threshold', () => {
    const enforced: EnforcedPair[] = [{ grade: '10', subject_code: 'science', enabled: true }];
    const ratios = { '10::science': 0.95 };
    expect(pairsToAutoDisable(enforced, ratios)).toEqual([]);
  });

  it('does NOT auto-disable pairs that are already disabled', () => {
    const enforced: EnforcedPair[] = [{ grade: '10', subject_code: 'science', enabled: false }];
    const ratios = { '10::science': 0.10 };
    expect(pairsToAutoDisable(enforced, ratios)).toEqual([]);
  });

  it('does NOT auto-disable when ratio is missing (no data = fail safe)', () => {
    const enforced: EnforcedPair[] = [{ grade: '10', subject_code: 'science', enabled: true }];
    const ratios = {};
    expect(pairsToAutoDisable(enforced, ratios)).toEqual([]);
  });

  it('handles multiple enforced pairs independently', () => {
    const enforced: EnforcedPair[] = [
      { grade: '10', subject_code: 'science', enabled: true }, // 0.80 → disable
      { grade: '10', subject_code: 'math', enabled: true },    // 0.90 → keep
      { grade: '9', subject_code: 'science', enabled: true },  // 0.50 → disable
    ];
    const ratios = { '10::science': 0.80, '10::math': 0.90, '9::science': 0.50 };
    const out = pairsToAutoDisable(enforced, ratios);
    expect(out.map(p => `${p.grade}::${p.subject_code}`).sort()).toEqual([
      '10::science', '9::science',
    ]);
  });

  it('threshold is configurable', () => {
    const enforced: EnforcedPair[] = [{ grade: '10', subject_code: 'science', enabled: true }];
    const ratios = { '10::science': 0.70 };
    expect(pairsToAutoDisable(enforced, ratios, 0.50)).toEqual([]);
    expect(pairsToAutoDisable(enforced, ratios, 0.80)).toHaveLength(1);
  });
});

describe('coverage-audit / snapshot idempotency (semantic check)', () => {
  // The shared helpers are pure; idempotency for the Edge Function comes from
  // the UNIQUE constraint on coverage_audit_snapshots.snapshot_date + the
  // onConflict upsert. This suite documents the invariant we rely on.
  it('summarizeSnapshot of the same rows twice yields identical output', () => {
    const rows = [
      row('10', 'science', 1, 'ready', 50, 40),
      row('10', 'science', 2, 'partial', 20, 10),
    ];
    const a = summarizeSnapshot(rows);
    const b = summarizeSnapshot(rows);
    expect(a).toEqual(b);
  });

  it('detectRegressions is deterministic on identical inputs', () => {
    const y = [row('10', 'science', 1, 'ready')];
    const t = [row('10', 'science', 1, 'missing')];
    const a = detectRegressions(y, t);
    const b = detectRegressions(y, t);
    expect(a).toEqual(b);
  });
});

describe('coverage-audit / threshold constant sanity', () => {
  it('AUTO_DISABLE_RATIO_THRESHOLD matches spec §8.2 (0.85)', () => {
    expect(AUTO_DISABLE_RATIO_THRESHOLD).toBe(0.85);
  });
});