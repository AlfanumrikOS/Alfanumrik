/**
 * Unit tests for packages/lib/src/irt/estimate-theta.ts (Phase 3 E2).
 *
 * The module is the PURE TS twin of the `update_irt_theta` SQL Newton-Raphson
 * (supabase/migrations/20260506000001 + baseline:8326). Fixtures here are
 * derived from the SQL math two ways:
 *   1. Hand-traced small cases (symmetric cancel, all-correct clip).
 *   2. A REFERENCE implementation transcribed line-for-line from the SQL text
 *      (independent of the module's own code) compared over a fixture grid.
 *
 * SQL constants pinned: theta clip [-4, 4], 5 iterations, 1e-3 convergence,
 * P clip [0.0001, 0.9999], L'' guard 1e-8, min 2 responses.
 * DELIBERATE divergence pinned: SE clamped to [0.3, 1.5] for the
 * student_skill_state.theta_se contract (SQL caps at 9.99 for
 * student_learning_profiles — different consumer, different bound).
 */
import { describe, it, expect } from 'vitest';
import {
  estimateTheta,
  THETA_MIN,
  THETA_MAX,
  MAX_ITERATIONS,
  CONVERGENCE_DELTA,
  P_CLIP_LO,
  P_CLIP_HI,
  L_DOUBLE_GUARD,
  MIN_RESPONSES,
  SE_FLOOR,
  SE_CAP,
  type ThetaResponse,
} from '@alfanumrik/lib/irt/estimate-theta';

// ── Reference implementation: literal transcription of the SQL loop ──────────
// (baseline:8326 / migration 20260506000001 — Rasch ICC, same clips/guards.)
function sqlReferenceTheta(responses: Array<{ b: number; x: number }>): number {
  let theta = 0.0;
  for (let iter = 1; iter <= 5; iter++) {
    let lPrime = 0.0;
    let lDouble = 0.0;
    for (const r of responses) {
      let p = 1.0 / (1.0 + Math.exp(-(theta - r.b)));
      p = Math.max(0.0001, Math.min(0.9999, p));
      lPrime += r.x - p;
      lDouble -= p * (1.0 - p);
    }
    if (Math.abs(lDouble) < 1e-8) break;
    const thetaPrev = theta;
    theta = theta - lPrime / lDouble;
    theta = Math.max(-4.0, Math.min(4.0, theta));
    if (Math.abs(theta - thetaPrev) < 0.001) break;
  }
  return theta;
}

function sqlReferenceSeUnclamped(theta: number, responses: Array<{ b: number }>): number {
  let fi = 0.0;
  for (const r of responses) {
    let p = 1.0 / (1.0 + Math.exp(-(theta - r.b)));
    p = Math.max(0.0001, Math.min(0.9999, p));
    fi += p * (1.0 - p);
  }
  return fi > 0 ? 1.0 / Math.sqrt(fi) : 9.99;
}

const R = (b: number, correct: boolean): ThetaResponse => ({ b, correct });

describe('estimateTheta — SQL constant pins', () => {
  it('exports the verified SQL constants', () => {
    expect(THETA_MIN).toBe(-4.0);
    expect(THETA_MAX).toBe(4.0);
    expect(MAX_ITERATIONS).toBe(5);
    expect(CONVERGENCE_DELTA).toBe(0.001);
    expect(P_CLIP_LO).toBe(0.0001);
    expect(P_CLIP_HI).toBe(0.9999);
    expect(L_DOUBLE_GUARD).toBe(1e-8);
    expect(MIN_RESPONSES).toBe(2);
  });

  it('pins the deliberate skill-state SE bounds (floor 0.3, cap 1.5)', () => {
    expect(SE_FLOOR).toBe(0.3);
    expect(SE_CAP).toBe(1.5);
  });
});

describe('estimateTheta — minimum-data + input hygiene (SQL: n < 2 → RETURN)', () => {
  it('returns null with 0 or 1 responses', () => {
    expect(estimateTheta([])).toBeNull();
    expect(estimateTheta([R(0, true)])).toBeNull();
  });

  it('drops non-finite b before the count check (SQL: irt_difficulty IS NOT NULL)', () => {
    expect(estimateTheta([R(NaN, true), R(0, true)])).toBeNull();
    expect(estimateTheta([R(Infinity, true), R(0, false)])).toBeNull();
  });
});

describe('estimateTheta — hand-traced fixtures from the SQL math', () => {
  it('symmetric cancel: {b=0 correct, b=0 wrong} → theta 0, SE = 1/sqrt(0.5)', () => {
    // Iter 1: p = 0.5 each → L' = 0 → theta step 0 → converged at 0.
    // FI = 2 · 0.25 = 0.5 → SE = 1.41421... (inside [0.3, 1.5], unclamped).
    const est = estimateTheta([R(0, true), R(0, false)]);
    expect(est).not.toBeNull();
    expect(est!.theta).toBeCloseTo(0, 12);
    expect(est!.se).toBeCloseTo(1 / Math.sqrt(0.5), 10);
    expect(est!.converged).toBe(true);
    expect(est!.n).toBe(2);
  });

  it('all-correct at b=0 (n=5): theta hits the +4 clip, SE hits the 1.5 cap', () => {
    // Hand trace: iter1 θ=2; iter2 θ≈3.1353; iter3 clips to 4; iter4 clips to
    // 4 again → |Δ|=0 < 0.001 → converged AT the clip.
    const est = estimateTheta(Array.from({ length: 5 }, () => R(0, true)));
    expect(est).not.toBeNull();
    expect(est!.theta).toBe(4);
    // Unclamped SE at θ=4 over 5 easy items ≈ 3.37 → clamped to the 1.5 cap
    // (the skill-state divergence; the SQL would cap at 9.99).
    expect(est!.se).toBe(SE_CAP);
    expect(est!.converged).toBe(true);
  });

  it('all-wrong at b=0 mirrors to the -4 clip', () => {
    const est = estimateTheta(Array.from({ length: 5 }, () => R(0, false)));
    expect(est!.theta).toBe(-4);
  });

  it('SE floor: a long response history clamps up to 0.3', () => {
    // 100 alternating correct/wrong at b=0 → theta 0, FI = 25 → raw SE = 0.2
    // → clamped to the 0.3 floor.
    const responses = Array.from({ length: 100 }, (_, i) => R(0, i % 2 === 0));
    const est = estimateTheta(responses);
    expect(est!.theta).toBeCloseTo(0, 12);
    expect(est!.se).toBe(SE_FLOOR);
  });
});

describe('estimateTheta — parity with the SQL-transcribed reference over a fixture grid', () => {
  const FIXTURES: Array<ThetaResponse[]> = [
    // Mixed abilities and difficulties, including negatives and extremes.
    [R(-1, true), R(0, true), R(1, false)],
    [R(-2, true), R(-1, true), R(0, true), R(1, false), R(2, false)],
    [R(0.5, false), R(0.5, false), R(-0.5, true)],
    [R(3, false), R(2.5, false), R(-3, true), R(-2.5, true), R(0, true), R(0, false)],
    [R(1.7, true), R(1.7, true), R(1.7, true), R(-0.3, false)],
    [R(-4, true), R(4, false), R(0, true), R(0.25, false), R(-0.25, true)],
  ];

  for (const [i, fixture] of FIXTURES.entries()) {
    it(`fixture ${i}: theta and SE match the SQL reference exactly`, () => {
      const est = estimateTheta(fixture);
      expect(est).not.toBeNull();
      const ref = sqlReferenceTheta(fixture.map((r) => ({ b: r.b, x: r.correct ? 1 : 0 })));
      expect(est!.theta).toBeCloseTo(ref, 12);
      const refSe = sqlReferenceSeUnclamped(ref, fixture);
      expect(est!.se).toBeCloseTo(Math.max(SE_FLOOR, Math.min(SE_CAP, refSe)), 12);
      expect(est!.theta).toBeGreaterThanOrEqual(THETA_MIN);
      expect(est!.theta).toBeLessThanOrEqual(THETA_MAX);
    });
  }

  it('monotonicity: more correct answers on the same items → higher theta', () => {
    const items = [-1, -0.5, 0, 0.5, 1];
    const weak = estimateTheta(items.map((b, i) => R(b, i < 1)));
    const strong = estimateTheta(items.map((b, i) => R(b, i < 4)));
    expect(strong!.theta).toBeGreaterThan(weak!.theta);
  });
});
