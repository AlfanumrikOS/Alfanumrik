/**
 * Learner-model facade — explainMastery (pure).
 *
 * Pins: evidence-quantity / accuracy / hinted-vs-independent / retention /
 * review-window / streak reason codes, the facts shape, determinism via the
 * injectable nowIso, and T1 neutrality (codes are evidence-language — no
 * identity labels).
 */

import { describe, it, expect } from 'vitest';
import { explainMastery, type MasteryState } from '@alfanumrik/lib/learner-model';

const NOW = '2026-08-05T12:00:00.000Z';

function state(overrides: Partial<MasteryState> = {}): MasteryState {
  return {
    topicId: 't1',
    title: 'Fractions',
    subjectId: 'subj-math',
    masteryProbability: 0.5,
    masteryLevel: 'developing',
    attempts: 10,
    correctAttempts: 7,
    hintsUsed: 2,
    easeFactor: 2.5,
    reviewIntervalDays: 6,
    nextReviewAt: null,
    lastAttemptedAt: '2026-08-01T00:00:00.000Z',
    retentionHalfLife: 96,
    currentRetention: 0.7,
    streakCurrent: 1,
    consecutiveWrong: 0,
    consecutiveCorrect: 1,
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('learner-model explainMastery', () => {
  it('no attempts → no_attempts_yet, accuracy null', () => {
    const e = explainMastery(state({ attempts: 0, correctAttempts: 0, hintsUsed: 0 }), NOW);
    expect(e.reasonCodes).toContain('no_attempts_yet');
    expect(e.facts.accuracy).toBeNull();
    expect(e.facts.attempts).toBe(0);
  });

  it('thin evidence → few_attempts', () => {
    const e = explainMastery(state({ attempts: 3, correctAttempts: 3 }), NOW);
    expect(e.reasonCodes).toContain('few_attempts');
  });

  it('accuracy bands: high (>=0.8), mixed, low (<=0.5)', () => {
    expect(
      explainMastery(state({ attempts: 10, correctAttempts: 8 }), NOW).reasonCodes,
    ).toContain('high_accuracy_evidence');
    expect(
      explainMastery(state({ attempts: 10, correctAttempts: 7 }), NOW).reasonCodes,
    ).toContain('mixed_accuracy_evidence');
    expect(
      explainMastery(state({ attempts: 10, correctAttempts: 5 }), NOW).reasonCodes,
    ).toContain('low_accuracy_evidence');
  });

  it('hinted vs independent evidence (P8 quality signal)', () => {
    const hinted = explainMastery(state({ attempts: 10, hintsUsed: 6 }), NOW);
    expect(hinted.reasonCodes).toContain('hinted_evidence_dominant');
    expect(hinted.facts.hintedAttempts).toBe(6);
    expect(hinted.facts.independentAttempts).toBe(4);

    const independent = explainMastery(state({ attempts: 10, hintsUsed: 2 }), NOW);
    expect(independent.reasonCodes).toContain('independent_evidence_dominant');

    // hints untracked → neither code, hintedAttempts null.
    const untracked = explainMastery(state({ hintsUsed: null }), NOW);
    expect(untracked.reasonCodes).not.toContain('hinted_evidence_dominant');
    expect(untracked.reasonCodes).not.toContain('independent_evidence_dominant');
    expect(untracked.facts.hintedAttempts).toBeNull();
  });

  it('retention below 0.5 → retention_fading', () => {
    expect(
      explainMastery(state({ currentRetention: 0.3 }), NOW).reasonCodes,
    ).toContain('retention_fading');
    expect(
      explainMastery(state({ currentRetention: 0.9 }), NOW).reasonCodes,
    ).not.toContain('retention_fading');
  });

  it('review window vs the injected now: overdue / upcoming / absent', () => {
    const overdue = explainMastery(
      state({ nextReviewAt: '2026-08-01T00:00:00.000Z' }),
      NOW,
    );
    expect(overdue.reasonCodes).toContain('review_overdue');

    const upcoming = explainMastery(
      state({ nextReviewAt: '2026-08-10T00:00:00.000Z' }),
      NOW,
    );
    expect(upcoming.reasonCodes).toContain('review_upcoming');

    const none = explainMastery(state({ nextReviewAt: null }), NOW);
    expect(none.reasonCodes).not.toContain('review_overdue');
    expect(none.reasonCodes).not.toContain('review_upcoming');
    expect(none.facts.nextReviewAt).toBeNull();
  });

  it('streaks: recent_correct_streak (>=3) and recent_consecutive_errors (>=2)', () => {
    expect(
      explainMastery(state({ streakCurrent: 3 }), NOW).reasonCodes,
    ).toContain('recent_correct_streak');
    expect(
      explainMastery(state({ streakCurrent: 2 }), NOW).reasonCodes,
    ).not.toContain('recent_correct_streak');
    expect(
      explainMastery(state({ consecutiveWrong: 2 }), NOW).reasonCodes,
    ).toContain('recent_consecutive_errors');
  });

  it('facts carry the evidence numbers verbatim', () => {
    const e = explainMastery(state(), NOW);
    expect(e.facts).toEqual({
      attempts: 10,
      correctAttempts: 7,
      accuracy: 0.7,
      independentAttempts: 8,
      hintedAttempts: 2,
      retention: 0.7,
      retentionHalfLifeHours: 96,
      nextReviewAt: null,
      lastAttemptedAt: '2026-08-01T00:00:00.000Z',
    });
  });

  it('is deterministic for a fixed nowIso (pure)', () => {
    const s = state({ nextReviewAt: '2026-08-06T00:00:00.000Z' });
    expect(explainMastery(s, NOW)).toEqual(explainMastery(s, NOW));
  });

  it('T1 neutrality: reason codes are evidence-language, never identity labels', () => {
    // Exercise every branch and collect all codes produced.
    const all = [
      explainMastery(state({ attempts: 0 }), NOW),
      explainMastery(state({ attempts: 3, correctAttempts: 1 }), NOW),
      explainMastery(
        state({
          attempts: 10,
          correctAttempts: 2,
          hintsUsed: 8,
          currentRetention: 0.1,
          nextReviewAt: '2026-08-01T00:00:00.000Z',
          consecutiveWrong: 4,
        }),
        NOW,
      ),
      explainMastery(
        state({ attempts: 20, correctAttempts: 19, streakCurrent: 6 }),
        NOW,
      ),
    ].flatMap((e) => e.reasonCodes);
    const banned = /(struggl|weak_student|slow|smart|gifted|lazy|dumb|bad|poor_student|intelligen)/i;
    for (const code of all) {
      expect(code).not.toMatch(banned);
    }
  });
});
