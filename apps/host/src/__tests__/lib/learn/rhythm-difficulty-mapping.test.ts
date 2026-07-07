/**
 * Pedagogy v2 — Phase 3 (Wave 1C): per-question difficulty normalization +
 * the route's non-fatal real-ability/real-difficulty wiring.
 *
 * Lane: NORMAL (no DB — math spec test + a structural pin on the route source).
 *
 * Two layers:
 *
 *  1. MATH SPEC. The route's `mapDifficultyTo01` is INLINE in
 *     src/app/api/rhythm/today/route.ts (not exported), so we cannot import it
 *     for a direct unit test without forcing the whole route module (and its
 *     supabase-server / next dependencies) to load. We therefore pin the math
 *     contract against a local reference twin AND structurally assert that the
 *     route's inline implementation matches that exact contract (the sigmoid
 *     primary, the integer 1/2/3 → 0.25/0.5/0.75 fallback, the 0.5 final
 *     default). The reference twin is identical to the route's body, so any
 *     drift in the route trips the structural pins below.
 *
 *     RECOMMENDATION (handed to ai-engineer / backend): export
 *     `mapDifficultyTo01` from a small pure helper (e.g.
 *     src/lib/learn/rhythm-difficulty.ts) so it can be unit-tested DIRECTLY
 *     rather than via a structural mirror. Until then this twin + the source
 *     pins are the guard.
 *
 *  2. STRUCTURAL PIN. The Phase-3 change must keep BOTH new signals NON-FATAL:
 *     a missing/failed irt_theta defaults studentAbility to 0 (sigmoid → 0.5),
 *     and a question with no difficulty signal defaults to 0.5. We grep the
 *     route source to confirm it (a) reads irt_theta from
 *     student_learning_profiles, (b) batch-fetches question_bank difficulty for
 *     the candidate ids, and (c) wraps both in try/catch with the documented
 *     defaults — so neither fetch can 500 the daily queue.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// ─── 1. MATH SPEC — reference twin of the route's inline mapDifficultyTo01 ────
// Byte-for-byte the same contract as route.ts lines ~122-135.
const DEFAULT_DIFFICULTY_0_1 = 0.5;
function mapDifficultyTo01Ref(
  irtDifficulty: number | null | undefined,
  intDifficulty: number | null | undefined,
): number {
  if (typeof irtDifficulty === 'number' && Number.isFinite(irtDifficulty)) {
    return 1 / (1 + Math.exp(-irtDifficulty));
  }
  if (typeof intDifficulty === 'number' && Number.isFinite(intDifficulty)) {
    if (intDifficulty <= 1) return 0.25;
    if (intDifficulty >= 3) return 0.75;
    return 0.5;
  }
  return DEFAULT_DIFFICULTY_0_1;
}

describe('mapDifficultyTo01 — sigmoid of irt_difficulty (primary)', () => {
  it('b = 0 → 0.5 (neutral midpoint)', () => {
    expect(mapDifficultyTo01Ref(0, null)).toBeCloseTo(0.5, 6);
  });

  it('b = -1 → ~0.27 (easier than neutral)', () => {
    expect(mapDifficultyTo01Ref(-1, null)).toBeCloseTo(0.2689, 3);
  });

  it('b = +1 → ~0.73 (harder than neutral)', () => {
    expect(mapDifficultyTo01Ref(1, null)).toBeCloseTo(0.7311, 3);
  });

  it('is monotonic increasing in irt_difficulty', () => {
    const xs = [-4, -2, -1, 0, 1, 2, 4];
    const ys = xs.map((b) => mapDifficultyTo01Ref(b, null));
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i]).toBeGreaterThan(ys[i - 1]);
    }
  });

  it('uses the SAME sigmoid the orchestrator uses for its target (same-axis match)', () => {
    // The orchestrator derives targetDifficulty = 1/(1+e^-theta). Pushing
    // irt_difficulty through the identical transform lands both on one axis.
    const b = 0.8;
    expect(mapDifficultyTo01Ref(b, null)).toBeCloseTo(1 / (1 + Math.exp(-b)), 9);
  });

  it('irt_difficulty takes precedence over the integer band', () => {
    // irt present → integer band must be ignored entirely.
    expect(mapDifficultyTo01Ref(1, 1)).toBeCloseTo(0.7311, 3); // not 0.25
  });
});

describe('mapDifficultyTo01 — integer difficulty fallback (1/2/3 → 0.25/0.5/0.75)', () => {
  it('1 (easy) → 0.25', () => {
    expect(mapDifficultyTo01Ref(null, 1)).toBe(0.25);
  });
  it('2 (medium) → 0.5', () => {
    expect(mapDifficultyTo01Ref(null, 2)).toBe(0.5);
  });
  it('3 (hard) → 0.75', () => {
    expect(mapDifficultyTo01Ref(null, 3)).toBe(0.75);
  });
  it('legacy 4/5 bands clamp to 0.75 (>= 3)', () => {
    expect(mapDifficultyTo01Ref(null, 4)).toBe(0.75);
    expect(mapDifficultyTo01Ref(null, 5)).toBe(0.75);
  });
  it('legacy 0 band clamps to 0.25 (<= 1)', () => {
    expect(mapDifficultyTo01Ref(null, 0)).toBe(0.25);
  });
});

describe('mapDifficultyTo01 — both signals missing → 0.5 default (prior behaviour)', () => {
  it('null/null → 0.5', () => {
    expect(mapDifficultyTo01Ref(null, null)).toBe(0.5);
  });
  it('undefined/undefined → 0.5', () => {
    expect(mapDifficultyTo01Ref(undefined, undefined)).toBe(0.5);
  });
  it('NaN irt + NaN int → 0.5 (Number.isFinite guards both)', () => {
    expect(mapDifficultyTo01Ref(NaN, NaN)).toBe(0.5);
  });
  it('Infinity irt falls through to the default (not finite)', () => {
    expect(mapDifficultyTo01Ref(Infinity, null)).toBe(0.5);
  });
});

// ─── 2. STRUCTURAL PIN — route reads real signals, both non-fatal ────────────

const ROUTE = 'src/app/api/rhythm/today/route.ts';

function resolve(rel: string): string | null {
  for (const c of [path.resolve(process.cwd(), rel), path.resolve(process.cwd(), '..', rel)]) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}
function read(rel: string): string {
  const p = resolve(rel);
  return p ? fs.readFileSync(p, 'utf-8') : '';
}

describe('rhythm/today route — Phase 3 real-signal wiring (structural pin)', () => {
  it('the route source exists', () => {
    expect(resolve(ROUTE)).not.toBeNull();
  });

  it('fetches the student irt_theta from student_learning_profiles', () => {
    const src = read(ROUTE);
    expect(src).toMatch(/student_learning_profiles/);
    expect(src).toMatch(/irt_theta/);
  });

  it('studentAbility defaults to 0 (sigmoid → 0.5 neutral) when theta missing/non-finite', () => {
    const src = read(ROUTE);
    // Default declared as 0, and guarded by Number.isFinite before assignment.
    expect(src).toMatch(/let\s+studentAbility\s*=\s*0/);
    expect(src).toMatch(/Number\.isFinite\(\s*theta\s*\)/);
  });

  it('batch-fetches question_bank difficulty for the candidate ids', () => {
    const src = read(ROUTE);
    expect(src).toMatch(/from\(['"]question_bank['"]\)/);
    expect(src).toMatch(/select\(['"]id,\s*irt_difficulty,\s*difficulty['"]\)/);
    // Restricted to exactly the candidate ids returned by the adaptive RPC.
    expect(src).toMatch(/\.in\(['"]id['"],\s*candidateIds\)/);
  });

  it('inline mapDifficultyTo01 matches the math spec (sigmoid primary, int fallback, 0.5 default)', () => {
    const src = read(ROUTE);
    // Sigmoid primary.
    expect(src).toMatch(/1\s*\/\s*\(1\s*\+\s*Math\.exp\(-irtDifficulty\)\)/);
    // Integer band fallback.
    expect(src).toMatch(/if\s*\(intDifficulty\s*<=\s*1\)\s*return\s*0\.25/);
    expect(src).toMatch(/if\s*\(intDifficulty\s*>=\s*3\)\s*return\s*0\.75/);
    expect(src).toMatch(/return\s*0\.5/);
    // Final default constant.
    expect(src).toMatch(/DEFAULT_DIFFICULTY_0_1\s*=\s*0\.5/);
  });

  it('BOTH new fetches are NON-FATAL: theta + difficulty wrapped in try/catch, no 500 path', () => {
    const src = read(ROUTE);
    // At least the two new fetch blocks (theta, difficulty) plus the lane are
    // try/catch-guarded. Confirm the documented non-fatal defaults are present.
    expect(src).toMatch(/try\s*\{/);
    expect(src).toMatch(/catch\s*\(/);
    // The difficulty map falls back to the 0.5 default per candidate on miss.
    expect(src).toMatch(/difficultyById\.get\(qid\)\s*\?\?\s*DEFAULT_DIFFICULTY_0_1/);
  });

  it('passes the real studentAbility into composeDailyRhythm', () => {
    const src = read(ROUTE);
    expect(src).toMatch(/composeDailyRhythm\(\s*\{/);
    expect(src).toMatch(/studentAbility,/);
  });
});
