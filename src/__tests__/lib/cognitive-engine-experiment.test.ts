import { describe, it, expect } from 'vitest';
import {
  recordExperimentEvidence,
  type ExperimentEvidence,
} from '@/lib/cognitive-engine';
import { BLOOM_CEILING } from '@/lib/score-config';

/**
 * Cognitive Engine — Experiment Evidence Tests
 *
 * Validates the STEM Lab Tier 2 R5 wiring of viva-quiz scores into the
 * BKT-flavored mastery pipeline via `recordExperimentEvidence()`.
 *
 * What this protects:
 *   - P1 Score formula is NOT touched (this is a parallel mastery signal,
 *     not a quiz-score replacement). The viva counts as evidence; the
 *     authoritative quiz score still uses Math.round((c/t) * 100).
 *   - P5 Grade strings flow through untouched.
 *   - Anti-grind threshold (60s) matches the coin RPC `complete_experiment`.
 *   - Bloom ceiling from `score-config.BLOOM_CEILING` is respected.
 *   - BKT property: same evidence moves a low-mastery student more than a
 *     high-mastery one (diminishing returns at the top).
 */

const baseEvidence: ExperimentEvidence = {
  studentId: '11111111-1111-1111-1111-111111111111',
  topicKey: 'electricity.ohms_law',
  subject: 'physics',
  grade: '10', // P5: STRING
  bloomLevel: 'apply',
  difficulty: 2,
  vivaScore: 0,
  vivaMax: 0,
  timeSpentSeconds: 600,
};

describe('recordExperimentEvidence — Tier 2 R5 viva → mastery wiring', () => {
  it('perfect viva (5/5) on apply-level produces a positive mastery delta and "mastered" feedback', () => {
    const result = recordExperimentEvidence(
      { ...baseEvidence, vivaScore: 5, vivaMax: 5, timeSpentSeconds: 600 },
      0.5,
    );

    expect(result.masteryDelta).toBeGreaterThan(0);
    expect(result.newMasteryEstimate).toBeGreaterThan(0.5);
    // 'apply' ceiling is 0.75; perfect viva must not exceed it.
    expect(result.newMasteryEstimate).toBeLessThanOrEqual(BLOOM_CEILING.apply);
    // Perfect viva that pinned us to the apply ceiling should read as mastered.
    expect(result.feedback).toBe('mastered');
  });

  it('partial viva (3/5) produces a smaller positive delta and "progressing" feedback', () => {
    const partial = recordExperimentEvidence(
      { ...baseEvidence, vivaScore: 3, vivaMax: 5, timeSpentSeconds: 600 },
      0.5,
    );
    const perfect = recordExperimentEvidence(
      { ...baseEvidence, vivaScore: 5, vivaMax: 5, timeSpentSeconds: 600 },
      0.5,
    );

    expect(partial.masteryDelta).toBeGreaterThan(0);
    expect(partial.masteryDelta).toBeLessThan(perfect.masteryDelta);
    expect(partial.feedback).toBe('progressing');
  });

  it('failed viva (0/5) produces a non-positive delta and "needs_work" feedback', () => {
    const result = recordExperimentEvidence(
      { ...baseEvidence, vivaScore: 0, vivaMax: 5, timeSpentSeconds: 600 },
      0.5,
    );

    // 5 wrong answers in a row should never increase mastery.
    expect(result.masteryDelta).toBeLessThanOrEqual(0);
    expect(result.feedback).toBe('needs_work');
  });

  it('anti-grind: time < 60s returns masteryDelta=0 even on a perfect viva', () => {
    const result = recordExperimentEvidence(
      { ...baseEvidence, vivaScore: 5, vivaMax: 5, timeSpentSeconds: 10 },
      0.5,
    );

    // The 60s threshold mirrors the coin RPC `complete_experiment` so the
    // mastery system and the coin system can never disagree about what
    // counts as real engagement.
    expect(result.masteryDelta).toBe(0);
    expect(result.newMasteryEstimate).toBe(0.5);
    expect(result.feedback).toBe('needs_work');
  });

  it('no viva (vivaMax=0) returns masteryDelta=0 with "progressing" feedback', () => {
    const result = recordExperimentEvidence(
      { ...baseEvidence, vivaScore: 0, vivaMax: 0, timeSpentSeconds: 600 },
      0.5,
    );

    // Engagement-only sims (no viva attempted) still earn coins via the
    // RPC but don't move topic mastery.
    expect(result.masteryDelta).toBe(0);
    expect(result.newMasteryEstimate).toBe(0.5);
    expect(result.feedback).toBe('progressing');
  });

  it("'remember' Bloom ceiling caps mastery at 0.45 even on a perfect viva", () => {
    const result = recordExperimentEvidence(
      {
        ...baseEvidence,
        bloomLevel: 'remember',
        vivaScore: 5,
        vivaMax: 5,
        timeSpentSeconds: 600,
      },
      0.4,
    );

    // BLOOM_CEILING.remember === 0.45 — a remember-level experiment can
    // never push topic mastery above 0.45, no matter how perfectly the
    // student performs. This forces depth (higher Bloom levels) over
    // breadth (lots of recall).
    expect(result.newMasteryEstimate).toBeLessThanOrEqual(0.45);
    expect(result.bloomCeilingHit).toBe(true);
  });

  it('BKT diminishing returns: same perfect viva moves low-mastery student more than high-mastery student', () => {
    const fromLow = recordExperimentEvidence(
      { ...baseEvidence, vivaScore: 5, vivaMax: 5, timeSpentSeconds: 600 },
      0.0,
    );
    const fromHigh = recordExperimentEvidence(
      { ...baseEvidence, vivaScore: 5, vivaMax: 5, timeSpentSeconds: 600 },
      0.7,
    );

    // Classic BKT property: posterior P(know|correct) saturates near 1,
    // so a student starting from 0.0 should see a larger absolute delta
    // than one starting from 0.7.
    expect(fromLow.masteryDelta).toBeGreaterThan(fromHigh.masteryDelta);
  });

  it('flat-prior default: omitting currentMastery uses 0.5 starting point', () => {
    const result = recordExperimentEvidence({
      ...baseEvidence,
      vivaScore: 5,
      vivaMax: 5,
      timeSpentSeconds: 600,
    });

    // Default prior is 0.5; perfect viva should produce a positive delta.
    expect(result.masteryDelta).toBeGreaterThan(0);
    expect(result.newMasteryEstimate).toBeGreaterThan(0.5);
  });

  it('grade is treated as string (P5) — function accepts "10" without coercion', () => {
    // Compile-time check: the type signature already enforces grade: string.
    // This test is a runtime guard against any future drift toward integers.
    const result = recordExperimentEvidence(
      { ...baseEvidence, grade: '10', vivaScore: 4, vivaMax: 5, timeSpentSeconds: 300 },
      0.3,
    );
    expect(result.masteryDelta).toBeGreaterThan(0);
    // The function should not throw or behave differently for grade '6'.
    const result2 = recordExperimentEvidence(
      { ...baseEvidence, grade: '6', vivaScore: 4, vivaMax: 5, timeSpentSeconds: 300 },
      0.3,
    );
    expect(result2.masteryDelta).toBeCloseTo(result.masteryDelta, 5);
  });
});
