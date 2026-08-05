/**
 * Learner-model facade — L3 ladder ORDER pin (Foxy North-Star Phase 4).
 *
 * The 7-tier new ladder (gated at the caller by `ff_foxy_decide_ladder_v1`,
 * seeded by migration 20260811000000) is pinned here by CONSTRUCTING an
 * input where all 7 tiers fire simultaneously, then peeling one tier per
 * assertion — starting from the top — to prove the strict spec order:
 *
 *   1. safety_hold     (safetyHold.active)
 *   2. assigned_work   (openAssignments earliest dueDate, NULLS LAST)
 *   3. revise          (overdue review — NEW: forgetting-risk-first)
 *   4. remediate       (prerequisite gap — SWAPPED with tier 3 vs. legacy)
 *   5. re_teach        (>=3 conceptual errors, unmastered concept exists)
 *   6. practice/challenge (unmastered concept)
 *   7. null            (nothing actionable)
 *
 * Also pins the legacy-mode contract: with `newLadder` OFF (undefined or
 * false) the ladder falls back to the pre-Phase-4 order (gap BEFORE
 * overdue), regardless of what safetyHold / openAssignments carry. That
 * makes the flag flip byte-identical to the retired path when disabled.
 */

import { describe, it, expect } from 'vitest';
import {
  deriveNextAction,
  type NextActionInputs,
  type SafetyHoldInput,
  type OpenAssignmentInput,
} from '@alfanumrik/lib/learner-model';

// Input where ALL 7 rungs would fire in isolation. Each `peel*` helper
// removes exactly ONE signal so the next rung becomes the head.
function allSevenTierInputs(): NextActionInputs & {
  safetyHold: SafetyHoldInput;
  openAssignments: OpenAssignmentInput[];
} {
  return {
    newLadder: true,
    safetyHold: {
      active: true,
      reason: 'safeguarding_escalation_open',
    },
    openAssignments: [
      // Two rows: chosen row must be the earlier due date (NULLS LAST tie).
      {
        assignmentId: 'a-late',
        title: 'Late Assignment',
        subjectCode: 'math',
        grade: '7', // P5: STRING grade
        dueDate: '2026-08-20T00:00:00.000Z',
        chapter: 'Chapter 3',
      },
      {
        assignmentId: 'a-early',
        title: 'Early Assignment',
        subjectCode: 'math',
        grade: '7',
        dueDate: '2026-08-10T00:00:00.000Z',
        chapter: 'Chapter 2',
      },
      {
        assignmentId: 'a-null',
        title: 'No-Due-Date Assignment',
        subjectCode: 'math',
        grade: '7',
        dueDate: null, // NULLS LAST
        chapter: null,
      },
    ],
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

describe('learner-model next-action — L3 new ladder strict 7-tier order', () => {
  it('(1) safety_hold preempts every other signal', () => {
    const a = deriveNextAction(allSevenTierInputs());
    expect(a).toEqual({
      actionType: 'safety_hold',
      conceptName: '',
      reason: 'Safeguarding escalation open — teaching paused pending review',
    });
  });

  it('(1b) safeguarding_review_pending renders the "review pending" reason', () => {
    const input = allSevenTierInputs();
    input.safetyHold = { active: true, reason: 'safeguarding_review_pending' };
    const a = deriveNextAction(input);
    expect(a).toEqual({
      actionType: 'safety_hold',
      conceptName: '',
      reason: 'Safeguarding review pending — teaching paused pending review',
    });
  });

  it('(1c) safetyHold with active:false does NOT fire — flows to tier 2', () => {
    const input = allSevenTierInputs();
    input.safetyHold = { active: false, reason: 'safeguarding_escalation_open' };
    const a = deriveNextAction(input);
    expect(a!.actionType).toBe('assigned_work');
  });

  it('(2) peel safety_hold → assigned_work, earliest dueDate first, NULLS LAST', () => {
    const input = allSevenTierInputs();
    input.safetyHold = { active: false, reason: 'safeguarding_escalation_open' };
    const a = deriveNextAction(input);
    expect(a).toEqual({
      actionType: 'assigned_work',
      conceptName: 'Early Assignment',
      reason: 'Open assignment is due — prioritising assigned work',
    });
  });

  it('(2b) all-null dueDates fall through to whichever remains first (NULLS LAST tie)', () => {
    const input = allSevenTierInputs();
    input.safetyHold = { active: false, reason: 'safeguarding_escalation_open' };
    input.openAssignments = [
      {
        assignmentId: 'x',
        title: 'X',
        subjectCode: 'math',
        grade: '7',
        dueDate: null,
        chapter: null,
      },
      {
        assignmentId: 'y',
        title: 'Y',
        subjectCode: 'math',
        grade: '7',
        dueDate: null,
        chapter: null,
      },
    ];
    const a = deriveNextAction(input);
    // Stable-ish: comparator returns 0 for null==null; first stays first.
    expect(a!.actionType).toBe('assigned_work');
  });

  it('(3) peel safety+assigned → revise (overdue-BEFORE-gap is the new-ladder swap)', () => {
    const input = allSevenTierInputs();
    input.safetyHold = { active: false, reason: 'safeguarding_escalation_open' };
    input.openAssignments = [];
    const a = deriveNextAction(input);
    expect(a).toEqual({
      actionType: 'revise',
      conceptName: 'Fractions', // weakest mastery first
      reason: 'Previously learned concept fading — revision needed',
    });
  });

  it('(4) peel revise → remediate (prerequisite gap)', () => {
    const input = allSevenTierInputs();
    input.safetyHold = { active: false, reason: 'safeguarding_escalation_open' };
    input.openAssignments = [];
    input.revisionDue = [];
    const a = deriveNextAction(input);
    expect(a).toEqual({
      actionType: 'remediate',
      conceptName: 'Integers',
      reason: 'Prerequisite gap needs remediation before advancing',
    });
  });

  it('(5) peel remediate → re_teach on weakest unmastered concept', () => {
    const input = allSevenTierInputs();
    input.safetyHold = { active: false, reason: 'safeguarding_escalation_open' };
    input.openAssignments = [];
    input.revisionDue = [];
    input.knowledgeGaps = [];
    const a = deriveNextAction(input);
    expect(a).toEqual({
      actionType: 're_teach',
      conceptName: 'Fractions',
      reason: 'Repeated conceptual errors — needs a different explanation approach',
    });
  });

  it('(6) peel re_teach → practice/challenge on the next unmastered concept', () => {
    const input = allSevenTierInputs();
    input.safetyHold = { active: false, reason: 'safeguarding_escalation_open' };
    input.openAssignments = [];
    input.revisionDue = [];
    input.knowledgeGaps = [];
    input.recentErrors = [];
    const a = deriveNextAction(input);
    expect(a!.actionType).toBe('practice'); // 0.2 < 0.6
    expect(a!.conceptName).toBe('Fractions');
  });

  it('(7) peel everything → null (no actionable signal)', () => {
    const a = deriveNextAction({
      newLadder: true,
      safetyHold: null,
      openAssignments: [],
      knowledgeGaps: [],
      revisionDue: [],
      recentErrors: [],
      masteryTopics: [],
    });
    expect(a).toBeNull();
  });
});

describe('learner-model next-action — LEGACY mode (flag OFF) compat pin', () => {
  it('legacy mode ignores safetyHold/openAssignments and runs gap-BEFORE-overdue', () => {
    // Same input as allSevenTierInputs() but WITHOUT newLadder — the legacy
    // 5-tier ladder must fire, and gap (Integers) beats overdue (Fractions).
    const input = allSevenTierInputs();
    delete (input as { newLadder?: boolean }).newLadder;
    const a = deriveNextAction(input);
    expect(a).toEqual({
      actionType: 'remediate',
      conceptName: 'Integers',
      reason: 'Prerequisite gap needs remediation before advancing',
    });
  });

  it('legacy mode with newLadder:false explicit — same behavior (byte-identical)', () => {
    const input = { ...allSevenTierInputs(), newLadder: false };
    const a = deriveNextAction(input);
    // Gap wins in legacy; safetyHold/openAssignments are ignored.
    expect(a!.actionType).toBe('remediate');
    expect(a!.conceptName).toBe('Integers');
  });

  it('legacy null-tier: no signals at all → null (mirrors pre-Phase-4)', () => {
    // No `newLadder` field at all — behavior must be identical to the
    // pre-Phase-4 test (5) case in next-action.test.ts.
    const a = deriveNextAction({
      knowledgeGaps: [],
      revisionDue: [],
      recentErrors: [],
      masteryTopics: [{ title: 'Topic', masteryProbability: 0.92 }],
    });
    expect(a).toBeNull();
  });
});
