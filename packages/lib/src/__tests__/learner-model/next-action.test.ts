/**
 * Learner-model facade — deriveNextAction order pin.
 *
 * The ladder MOVED VERBATIM from apps/host cognitive-context.ts (which now
 * re-exports from the facade); these cases are ported/adapted from the
 * apps/host `adaptive-differential.test.ts` order pins (REG-231..234) so the
 * canonical home carries its own behavior pin:
 *   (1) gap → remediate  (2) overdue → revise  (3) >=3 conceptual → re_teach
 *   (4) unmastered → practice/challenge  (5) nothing → null.
 *
 * Also pins the Phase 2 additions: getNextAction alias identity, the
 * OPTIONAL academicGoal input (annotation-only — MUST NOT change any ladder
 * output), and nullNextActionReason.
 */

import { describe, it, expect } from 'vitest';
import {
  deriveNextAction,
  getNextAction,
  nullNextActionReason,
  type NextActionInputs,
} from '@alfanumrik/lib/learner-model';

function weakLearnerInputs(): NextActionInputs {
  return {
    knowledgeGaps: [
      { target: 'Linear Equations', prerequisite: 'Integers', gapType: 'weak_prerequisite' },
    ],
    revisionDue: [
      { title: 'Decimals', lastReviewed: '2026-06-10T00:00:00.000Z', mastery: 55 },
      { title: 'Fractions', lastReviewed: '2026-06-20T00:00:00.000Z', mastery: 35 },
    ],
    recentErrors: [{ errorType: 'conceptual', count: 4 }],
    masteryTopics: [
      { title: 'Fractions', masteryProbability: 0.2 },
      { title: 'Decimals', masteryProbability: 0.45 },
    ],
  };
}

describe('learner-model next-action — ladder order pin (moved verbatim)', () => {
  it('(1) knowledge gap beats everything → remediate the PREREQUISITE', () => {
    const a = deriveNextAction(weakLearnerInputs());
    expect(a).toEqual({
      actionType: 'remediate',
      conceptName: 'Integers',
      reason: 'Prerequisite gap needs remediation before advancing',
    });
  });

  it('(1b) gap without prerequisite remediates the target', () => {
    const inputs = weakLearnerInputs();
    inputs.knowledgeGaps = [
      { target: 'Linear Equations', prerequisite: '', gapType: 'weak_prerequisite' },
    ];
    const a = deriveNextAction(inputs);
    expect(a!.actionType).toBe('remediate');
    expect(a!.conceptName).toBe('Linear Equations');
  });

  it('(2) overdue review next: weakest mastery first', () => {
    const inputs = weakLearnerInputs();
    inputs.knowledgeGaps = [];
    const a = deriveNextAction(inputs);
    expect(a!.actionType).toBe('revise');
    expect(a!.conceptName).toBe('Fractions'); // 35 < 55
  });

  it('(2b) overdue mastery tie breaks toward the OLDEST review timestamp', () => {
    const a = deriveNextAction({
      knowledgeGaps: [],
      revisionDue: [
        { title: 'Newer', lastReviewed: '2026-06-25T00:00:00.000Z', mastery: 40 },
        { title: 'Older', lastReviewed: '2026-06-01T00:00:00.000Z', mastery: 40 },
      ],
      recentErrors: [],
      masteryTopics: [],
    });
    expect(a!.conceptName).toBe('Older');
  });

  it('(3) >=3 conceptual errors → re_teach the weakest unmastered concept', () => {
    const inputs = weakLearnerInputs();
    inputs.knowledgeGaps = [];
    inputs.revisionDue = [];
    const a = deriveNextAction(inputs);
    expect(a!.actionType).toBe('re_teach');
    expect(a!.conceptName).toBe('Fractions');
  });

  it('(3b) exactly 2 conceptual errors fall through the re_teach rung', () => {
    const base: NextActionInputs = {
      knowledgeGaps: [],
      revisionDue: [],
      recentErrors: [{ errorType: 'conceptual', count: 2 }],
      masteryTopics: [{ title: 'Topic', masteryProbability: 0.5 }],
    };
    expect(deriveNextAction(base)!.actionType).toBe('practice');
  });

  it('(4) practice below 0.6, challenge in [0.6, 0.85), null at >= 0.85', () => {
    const masteryOnly = (m: number) =>
      deriveNextAction({
        knowledgeGaps: [],
        revisionDue: [],
        recentErrors: [],
        masteryTopics: [{ title: 'Topic', masteryProbability: m }],
      });
    expect(masteryOnly(0.59)!.actionType).toBe('practice');
    expect(masteryOnly(0.6)!.actionType).toBe('challenge');
    expect(masteryOnly(0.84)!.actionType).toBe('challenge');
    expect(masteryOnly(0.85)).toBeNull();
  });

  it('(5) no actionable signal → null (STRONG learner)', () => {
    expect(
      deriveNextAction({
        knowledgeGaps: [],
        revisionDue: [],
        recentErrors: [],
        masteryTopics: [{ title: 'Topic', masteryProbability: 0.92 }],
      }),
    ).toBeNull();
  });

  it('conceptual errors alone (nothing unmastered) do NOT force re_teach', () => {
    expect(
      deriveNextAction({
        knowledgeGaps: [],
        revisionDue: [],
        recentErrors: [{ errorType: 'conceptual', count: 5 }],
        masteryTopics: [{ title: 'Topic', masteryProbability: 0.9 }],
      }),
    ).toBeNull();
  });
});

describe('learner-model next-action — Phase 2 facade additions', () => {
  it('getNextAction IS deriveNextAction (alias, not a wrapper)', () => {
    expect(getNextAction).toBe(deriveNextAction);
  });

  it('academicGoal is annotation-only: identical outputs with and without it', () => {
    const withGoal = { ...weakLearnerInputs(), academicGoal: { code: 'top_ranks' } };
    expect(deriveNextAction(withGoal)).toEqual(deriveNextAction(weakLearnerInputs()));

    const nullCase: NextActionInputs = {
      knowledgeGaps: [],
      revisionDue: [],
      recentErrors: [],
      masteryTopics: [],
      academicGoal: { code: 'top_ranks' },
    };
    // Tier 5 STILL returns bare null — no ladder reordering, no synthetic action.
    expect(deriveNextAction(nullCase)).toBeNull();
  });

  it('nullNextActionReason annotates the tier-5 null case with the goal code', () => {
    expect(nullNextActionReason({ code: 'pass_comfortably' })).toBe(
      "No actionable signal — defaulting to the 'pass_comfortably' goal rails (exam-prep / cold-start)",
    );
    expect(nullNextActionReason(null)).toBe(
      'No actionable signal — exam-prep / cold-start rails apply',
    );
    expect(nullNextActionReason()).toBe(
      'No actionable signal — exam-prep / cold-start rails apply',
    );
  });
});
