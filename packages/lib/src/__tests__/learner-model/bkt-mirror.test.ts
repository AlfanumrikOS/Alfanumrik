/**
 * Learner-model facade — BKT mirror parity fixtures.
 *
 * Hand-computed posteriors from the EXACT SQL math in
 * update_learner_state_post_quiz (migration 20260623000100), starting from
 * the SQL's new-row prior 0.1 with the SQL default params
 * (learn 0.2 / slip 0.1 / guess 0.25):
 *
 *   correct from 0.1:
 *     pE = 0.1·0.9 + 0.9·0.25 = 0.315
 *     pK = 0.09 / 0.315       = 2/7
 *     post = 2/7 + (5/7)·0.2  = 3/7 ≈ 0.428571…
 *   wrong from 0.1:
 *     pE = 0.1·0.1 + 0.9·0.75 = 0.685
 *     pK = 0.01 / 0.685       ≈ 0.01459854…
 *     post ≈ 0.2116788321…
 *   correct,correct: 3/7 → 2.9/3.7 ≈ 0.78378378…
 *   correct,wrong:   3/7 → 3/11    ≈ 0.27272727…
 *
 * If these fail after a param change, the SQL WINS — fix the mirror, never
 * the RPC (E1: SQL is canonical; the mirror is display/preview only, E6).
 */

import { describe, it, expect } from 'vitest';
import {
  BKT_PARAMS,
  bktPosterior,
  bktPosteriorSequence,
} from '@alfanumrik/lib/learner-model';

describe('learner-model bkt-mirror — SQL parity (20260623000100)', () => {
  it('BKT_PARAMS carry the SQL defaults exactly', () => {
    expect(BKT_PARAMS.pLearn).toBe(0.2);
    expect(BKT_PARAMS.pSlip).toBe(0.1);
    expect(BKT_PARAMS.pGuess).toBe(0.25);
    expect(BKT_PARAMS.priorInit).toBe(0.1);
  });

  it('correct from the new-row prior 0.1 → 3/7', () => {
    expect(bktPosterior(0.1, true)).toBeCloseTo(3 / 7, 12);
  });

  it('wrong from the new-row prior 0.1 → 0.2116788321…', () => {
    // pK = 0.01/0.685; post = pK + (1-pK)*0.2
    const pK = 0.01 / 0.685;
    expect(bktPosterior(0.1, false)).toBeCloseTo(pK + (1 - pK) * 0.2, 12);
    expect(bktPosterior(0.1, false)).toBeCloseTo(0.2116788321, 9);
  });

  it('sequence correct,correct from prior 0.1 → 2.9/3.7', () => {
    expect(bktPosteriorSequence([true, true])).toBeCloseTo(2.9 / 3.7, 12);
  });

  it('sequence correct,wrong from prior 0.1 → 3/11', () => {
    expect(bktPosteriorSequence([true, false])).toBeCloseTo(3 / 11, 12);
  });

  it('sequence defaults to the SQL new-row prior 0.1', () => {
    expect(bktPosteriorSequence([true])).toBeCloseTo(bktPosterior(0.1, true), 12);
  });

  it('posterior is monotone in evidence direction and clamped to [0,1]', () => {
    // Correct always raises, wrong always lowers relative to a mid prior.
    expect(bktPosterior(0.5, true)).toBeGreaterThan(0.5);
    // From the mirror math, learn-transit can offset a wrong answer at low
    // priors — assert only the clamp bounds across the domain.
    for (const prior of [0, 0.001, 0.1, 0.5, 0.9, 0.999, 1]) {
      for (const correct of [true, false]) {
        const p = bktPosterior(prior, correct);
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
      }
    }
  });

  it('wrong answer from a mid prior lands below the learn-transit of that prior', () => {
    // Sanity: a wrong answer at prior 0.5 gives pK = 0.05/0.425 ≈ 0.1176;
    // post ≈ 0.294 — strictly below the prior.
    expect(bktPosterior(0.5, false)).toBeCloseTo(
      (() => {
        const pK = (0.5 * 0.1) / (0.5 * 0.1 + 0.5 * 0.75);
        return pK + (1 - pK) * 0.2;
      })(),
      12,
    );
    expect(bktPosterior(0.5, false)).toBeLessThan(0.5);
  });
});
