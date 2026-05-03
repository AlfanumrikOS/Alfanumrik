/**
 * GoalScorecardSentence — component tests (Phase 1 of Goal-Adaptive Layers).
 *
 * Pins:
 *   - Returns null for unknown / null goal codes (no DOM node).
 *   - isHi=false renders the EN sentence; isHi=true renders the HI sentence.
 *   - data-tone matches GOAL_PROFILES[goal].scorecardTone for each goal.
 *   - Renders the goal-label caption ("Your goal: ..." / "तुम्हारा लक्ष्य: ...").
 *
 * The component itself does ZERO IO and ZERO score recomputation — these
 * tests only validate the layer that picks language and renders accent.
 */

import { describe, it, expect } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

import GoalScorecardSentence from '@/components/quiz/GoalScorecardSentence';
import { GOAL_PROFILES, type GoalCode } from '@/lib/goals/goal-profile';
import { buildScorecardSentence } from '@/lib/goals/scorecard-sentence';

afterEach(() => cleanup());

const ALL_GOALS: GoalCode[] = [
  'improve_basics',
  'pass_comfortably',
  'school_topper',
  'board_topper',
  'competitive_exam',
  'olympiad',
];

const baseProps = {
  correct: 4,
  total: 5,
  scorePercent: 80,
  xpEarned: 50,
};

describe('GoalScorecardSentence — null/no-op cases', () => {
  it('renders nothing when goal is null', () => {
    const { container } = render(
      <GoalScorecardSentence goal={null} {...baseProps} isHi={false} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when goal is unknown', () => {
    const { container } = render(
      <GoalScorecardSentence
        goal="some_made_up_goal"
        {...baseProps}
        isHi={false}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for empty-string goal', () => {
    const { container } = render(
      <GoalScorecardSentence goal="" {...baseProps} isHi={false} />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe('GoalScorecardSentence — language selection', () => {
  it('isHi=false renders the EN sentence text', () => {
    render(
      <GoalScorecardSentence
        goal="improve_basics"
        {...baseProps}
        isHi={false}
      />,
    );
    const sentence = buildScorecardSentence({
      goal: 'improve_basics',
      ...baseProps,
      isHi: false,
    });
    expect(screen.getByText(sentence.en)).toBeInTheDocument();
    // HI version must NOT be present when isHi=false (sanity check).
    expect(screen.queryByText(sentence.hi)).not.toBeInTheDocument();
  });

  it('isHi=true renders the HI sentence text (Devanagari)', () => {
    render(
      <GoalScorecardSentence
        goal="improve_basics"
        {...baseProps}
        isHi={true}
      />,
    );
    const sentence = buildScorecardSentence({
      goal: 'improve_basics',
      ...baseProps,
      isHi: true,
    });
    expect(screen.getByText(sentence.hi)).toBeInTheDocument();
    expect(screen.queryByText(sentence.en)).not.toBeInTheDocument();
  });
});

describe('GoalScorecardSentence — tone wiring', () => {
  it.each(ALL_GOALS)(
    '%s renders data-tone matching GOAL_PROFILES.scorecardTone',
    (goal) => {
      render(
        <GoalScorecardSentence goal={goal} {...baseProps} isHi={false} />,
      );
      const node = screen.getByTestId('goal-scorecard-sentence');
      expect(node.getAttribute('data-tone')).toBe(
        GOAL_PROFILES[goal].scorecardTone,
      );
    },
  );

  it.each(ALL_GOALS)(
    '%s renders the bilingual goal-label caption',
    (goal) => {
      // EN render
      render(
        <GoalScorecardSentence goal={goal} {...baseProps} isHi={false} />,
      );
      const enCaption = screen.getByText(
        new RegExp(`Your goal:\\s*${escapeRegExp(GOAL_PROFILES[goal].labelEn)}`),
      );
      expect(enCaption).toBeInTheDocument();
      cleanup();

      // HI render
      render(
        <GoalScorecardSentence goal={goal} {...baseProps} isHi={true} />,
      );
      const hiCaption = screen.getByText(
        new RegExp(`तुम्हारा लक्ष्य:\\s*${escapeRegExp(GOAL_PROFILES[goal].labelHi)}`),
      );
      expect(hiCaption).toBeInTheDocument();
    },
  );

  it('container has data-testid for E2E hooks', () => {
    render(
      <GoalScorecardSentence
        goal="board_topper"
        {...baseProps}
        isHi={false}
      />,
    );
    expect(screen.getByTestId('goal-scorecard-sentence')).toBeInTheDocument();
  });
});

// Small util — ProfileLabels contain regex-special chars (parentheses,
// percent, slash). Escape them before building a RegExp.
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
