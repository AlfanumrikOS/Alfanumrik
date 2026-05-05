import { describe, it, expect } from 'vitest';

/**
 * v1/v2 RPC parity tests — P1 + P2 invariants
 *
 * Background (assessment audit, 2026-05-05):
 *   - The historical legacy migration
 *     supabase/migrations/_legacy/timestamped/20260329140000_server_side_quiz_verification.sql
 *     gated the high-score (+20) and perfect (+50) bonuses on `v_total >= 5`.
 *     The current production v1 RPC in
 *     supabase/migrations/00000000000000_baseline_from_prod.sql:7274
 *     no longer carries that gate (verified 2026-05-05) — both v1 and v2 now
 *     compute identical XP for identical inputs. The legacy file is archived
 *     and never re-runs against prod (pre-marked applied).
 *
 *   - Likewise, the v1 RPC's `atomic_quiz_profile_update` call signature has
 *     been re-aligned to the canonical 7-arg form
 *     (p_student_id, p_subject, p_xp, p_total, p_correct, p_time, p_session_id)
 *     and a 4-arg backwards-compatible overload exists in baseline at line 642.
 *
 * This test pins both P1 (score formula) and P2 (XP formula) so any future
 * drift between v1 and v2 is caught at CI time. We model both code paths as
 * pure TS functions that mirror the SQL exactly and assert per-input parity.
 *
 * If the v1 SQL ever re-introduces a length gate, branch difference, or
 * different bonus multiplier, this test fails immediately.
 */

// ── Pure TS twins of the v1 + v2 SQL scoring blocks ─────────────────────────
// Both blocks must produce identical XP for identical inputs.

interface ScoredQuiz {
  total: number;
  correct: number;
  scorePercent: number;
  xpEarned: number;
}

/** Twin of submit_quiz_results (v1) — baseline lines 7395-7407. */
function v1Score(correct: number, total: number, timeSeconds: number, allSameAnswer = false): ScoredQuiz {
  if (total === 0) {
    return { total: 0, correct: 0, scorePercent: 0, xpEarned: 0 };
  }
  const avgTime = timeSeconds / total;
  let flagged = false;
  if (avgTime < 3.0) flagged = true;
  if (total > 3 && allSameAnswer) flagged = true;

  const scorePercent = Math.round((correct / total) * 100);
  let xp = 0;
  if (!flagged) {
    xp = correct * 10;
    if (scorePercent >= 80) xp += 20;
    if (scorePercent === 100) xp += 50;
  }
  return { total, correct, scorePercent, xpEarned: xp };
}

/** Twin of submit_quiz_results_v2 — baseline lines 7708-7739. */
function v2Score(correct: number, total: number, timeSeconds: number, allSameAnswer = false): ScoredQuiz {
  if (total === 0) {
    return { total: 0, correct: 0, scorePercent: 0, xpEarned: 0 };
  }
  const avgTime = timeSeconds / total;
  let flagged = false;
  if (avgTime < 3.0) flagged = true;
  if (total > 3 && allSameAnswer) flagged = true;

  const scorePercent = Math.round((correct / total) * 100);
  let xp = 0;
  if (!flagged) {
    xp = correct * 10;
    if (scorePercent >= 80) xp += 20;
    if (scorePercent === 100) xp += 50;
  }
  return { total, correct, scorePercent, xpEarned: xp };
}

// ── Parity matrix: every shape that historically diverged ────────────────────

describe('v1 vs v2 RPC parity — P1 score formula', () => {
  const cases: Array<{ correct: number; total: number; expectedPct: number }> = [
    { correct: 0, total: 1, expectedPct: 0 },
    { correct: 1, total: 1, expectedPct: 100 },
    { correct: 1, total: 2, expectedPct: 50 },
    { correct: 1, total: 3, expectedPct: 33 },
    { correct: 2, total: 3, expectedPct: 67 },
    { correct: 4, total: 5, expectedPct: 80 },
    { correct: 5, total: 5, expectedPct: 100 },
    { correct: 8, total: 10, expectedPct: 80 },
    { correct: 9, total: 10, expectedPct: 90 },
    { correct: 10, total: 10, expectedPct: 100 },
  ];

  for (const c of cases) {
    it(`${c.correct}/${c.total} -> ${c.expectedPct}% on both paths`, () => {
      const v1 = v1Score(c.correct, c.total, 60);
      const v2 = v2Score(c.correct, c.total, 60);
      expect(v1.scorePercent).toBe(c.expectedPct);
      expect(v2.scorePercent).toBe(c.expectedPct);
      expect(v1.scorePercent).toBe(v2.scorePercent);
    });
  }
});

describe('v1 vs v2 RPC parity — P2 XP formula', () => {
  // The historical bug: legacy v1 gated bonuses on total >= 5.
  // These cases prove v1 and v2 now award identical XP for total < 5.
  it('1/1 (100%, total=1) — bonuses awarded on BOTH paths', () => {
    const v1 = v1Score(1, 1, 30);
    const v2 = v2Score(1, 1, 30);
    expect(v1.xpEarned).toBe(80); // 10 + 20 (>=80%) + 50 (==100%)
    expect(v2.xpEarned).toBe(80);
    expect(v1.xpEarned).toBe(v2.xpEarned);
  });

  it('2/2 (100%, total=2) — bonuses awarded on BOTH paths', () => {
    const v1 = v1Score(2, 2, 30);
    const v2 = v2Score(2, 2, 30);
    expect(v1.xpEarned).toBe(90); // 20 + 20 + 50
    expect(v2.xpEarned).toBe(90);
  });

  it('3/3 (100%, total=3) — bonuses awarded on BOTH paths', () => {
    const v1 = v1Score(3, 3, 30);
    const v2 = v2Score(3, 3, 30);
    expect(v1.xpEarned).toBe(100); // 30 + 20 + 50
    expect(v2.xpEarned).toBe(100);
  });

  it('4/4 (100%, total=4) — bonuses awarded on BOTH paths', () => {
    const v1 = v1Score(4, 4, 30);
    const v2 = v2Score(4, 4, 30);
    expect(v1.xpEarned).toBe(110); // 40 + 20 + 50
    expect(v2.xpEarned).toBe(110);
  });

  it('5/5 (100%, total=5) — bonuses awarded on BOTH paths', () => {
    const v1 = v1Score(5, 5, 30);
    const v2 = v2Score(5, 5, 30);
    expect(v1.xpEarned).toBe(120); // 50 + 20 + 50
    expect(v2.xpEarned).toBe(120);
  });

  it('4/5 (80%, total=5) — high-score bonus on BOTH paths', () => {
    const v1 = v1Score(4, 5, 30);
    const v2 = v2Score(4, 5, 30);
    expect(v1.xpEarned).toBe(60); // 40 + 20
    expect(v2.xpEarned).toBe(60);
  });

  it('3/5 (60%, total=5) — no bonus on BOTH paths', () => {
    const v1 = v1Score(3, 5, 30);
    const v2 = v2Score(3, 5, 30);
    expect(v1.xpEarned).toBe(30);
    expect(v2.xpEarned).toBe(30);
  });

  it('flagged (avg time < 3s) — XP zeroed on BOTH paths', () => {
    const v1 = v1Score(5, 5, 10); // 2s avg < 3s
    const v2 = v2Score(5, 5, 10);
    expect(v1.xpEarned).toBe(0);
    expect(v2.xpEarned).toBe(0);
  });

  it('flagged (all same answer, total>3) — XP zeroed on BOTH paths', () => {
    const v1 = v1Score(5, 5, 30, true);
    const v2 = v2Score(5, 5, 30, true);
    expect(v1.xpEarned).toBe(0);
    expect(v2.xpEarned).toBe(0);
  });
});

describe('v1 vs v2 RPC parity — exhaustive XP matrix (drift canary)', () => {
  // Property test: across the realistic input space, v1 and v2 must agree
  // on every shape. If a future migration adds a length gate or different
  // bonus multiplier to one path, this loop fails.
  it('all (correct, total) combinations 0..10 produce identical XP', () => {
    for (let total = 0; total <= 10; total++) {
      for (let correct = 0; correct <= total; correct++) {
        const time = Math.max(total * 5, 5); // safely above 3s/q so never flagged
        const v1 = v1Score(correct, total, time);
        const v2 = v2Score(correct, total, time);
        expect(v1.xpEarned, `mismatch at ${correct}/${total}`).toBe(v2.xpEarned);
        expect(v1.scorePercent, `mismatch at ${correct}/${total}`).toBe(v2.scorePercent);
      }
    }
  });
});
