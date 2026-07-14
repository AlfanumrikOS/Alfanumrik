import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';

/**
 * Phase 2.1 — Teaching Director plan-driven buttons (ff_foxy_teaching_director_v1).
 *
 * Contract (ChatBubble half):
 *   - `suggestedButtons` present ⇒ the learning-action bar renders ONLY the
 *     listed primary buttons (context-aware). The others are absent.
 *   - `suggestedButtons` absent ⇒ all four primary buttons render (byte-identical
 *     to today's static bar). This is the flag-OFF / no-plan path.
 *   - `suggestedButtons` empty ⇒ no primary buttons (only the overflow utility).
 *   - The rendered buttons STILL dispatch their real actions via onLearningAction.
 *   - `nextActions` present ⇒ a subtle, display-only chip row renders, bilingual
 *     via AuthContext.isHi. Absent ⇒ no chip row.
 *
 * These fields only matter while the learning-action bar itself is enabled
 * (`learningActionsEnabled`), which is the surface that shows the four buttons.
 */

let _isHi = false;
vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => ({ isHi: _isHi }),
}));
vi.mock('@alfanumrik/ui/foxy/ReportIssueModal', () => ({
  ReportIssueModal: () => null,
}));
vi.mock('@alfanumrik/ui/grounding/HardAbstainCard', () => ({
  HardAbstainCard: () => <div data-testid="hard-abstain-card" />,
}));

import ChatBubble, { type NextAction, type SuggestedButtonType } from '@alfanumrik/ui/foxy/ChatBubble';

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    role: 'tutor' as const,
    content: <div>The mitochondria is the powerhouse of the cell.</div>,
    rawContent: 'The mitochondria is the powerhouse of the cell.',
    timestamp: '2026-07-15T12:00:00.000Z',
    color: '#10B981',
    activeSubject: 'science',
    onFeedback: vi.fn(),
    onReport: vi.fn(),
    learningActionsEnabled: true,
    messageId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    ...overrides,
  };
}

const ALL_PRIMARY = [
  'learning-action-gotit',
  'learning-action-simpler',
  'learning-action-example',
  'learning-action-quiz',
] as const;

beforeEach(() => {
  cleanup();
  _isHi = false;
});

describe('Phase 2.1 — ChatBubble suggestedButtons gating', () => {
  it('ABSENT suggestedButtons ⇒ all four primary buttons render (byte-identical to today)', () => {
    render(<ChatBubble {...baseProps({ onLearningAction: vi.fn() })} />);
    for (const id of ALL_PRIMARY) expect(screen.getByTestId(id)).toBeTruthy();
    // Overflow utility unchanged.
    expect(screen.getByTestId('learning-action-overflow')).toBeTruthy();
  });

  it('PRESENT subset ⇒ renders ONLY the listed buttons', () => {
    const suggestedButtons: SuggestedButtonType[] = ['explain_simpler', 'show_example'];
    render(<ChatBubble {...baseProps({ onLearningAction: vi.fn(), suggestedButtons })} />);
    expect(screen.getByTestId('learning-action-simpler')).toBeTruthy();
    expect(screen.getByTestId('learning-action-example')).toBeTruthy();
    // Not suggested → absent.
    expect(screen.queryByTestId('learning-action-gotit')).toBeNull();
    expect(screen.queryByTestId('learning-action-quiz')).toBeNull();
    // Overflow utility still available regardless of the subset.
    expect(screen.getByTestId('learning-action-overflow')).toBeTruthy();
  });

  it('single-button subset ⇒ only that one primary button renders', () => {
    render(<ChatBubble {...baseProps({ onLearningAction: vi.fn(), suggestedButtons: ['quiz_me'] })} />);
    expect(screen.getByTestId('learning-action-quiz')).toBeTruthy();
    expect(screen.queryByTestId('learning-action-gotit')).toBeNull();
    expect(screen.queryByTestId('learning-action-simpler')).toBeNull();
    expect(screen.queryByTestId('learning-action-example')).toBeNull();
  });

  it('EMPTY subset ⇒ no primary buttons, overflow utility still renders', () => {
    render(<ChatBubble {...baseProps({ onLearningAction: vi.fn(), suggestedButtons: [] })} />);
    for (const id of ALL_PRIMARY) expect(screen.queryByTestId(id)).toBeNull();
    expect(screen.getByTestId('learning-action-overflow')).toBeTruthy();
  });

  it('a suggested button STILL dispatches its real action', () => {
    const onLearningAction = vi.fn();
    render(<ChatBubble {...baseProps({ onLearningAction, suggestedButtons: ['quiz_me'] })} />);
    fireEvent.click(screen.getByTestId('learning-action-quiz'));
    expect(onLearningAction).toHaveBeenCalledWith('quiz_me');
  });

  it('the surviving buttons keep the >=44px tap target', () => {
    render(<ChatBubble {...baseProps({ onLearningAction: vi.fn(), suggestedButtons: ['got_it'] })} />);
    expect(screen.getByTestId('learning-action-gotit').className).toContain('min-h-[44px]');
  });
});

describe('Phase 2.1 — ChatBubble nextActions chip row', () => {
  const nextActions: NextAction[] = [
    { kind: 'review_prerequisite', label: { en: 'Review fractions', hi: 'भिन्न दोहराओ' }, conceptId: 'c-1' },
    { kind: 'advance_topic', label: { en: 'Advance to decimals', hi: 'दशमलव पर बढ़ो' } },
  ];

  it('ABSENT nextActions ⇒ no chip row', () => {
    render(<ChatBubble {...baseProps({ onLearningAction: vi.fn() })} />);
    expect(screen.queryByTestId('learning-next-actions')).toBeNull();
  });

  it('PRESENT nextActions ⇒ renders the chip row with English labels', () => {
    render(<ChatBubble {...baseProps({ onLearningAction: vi.fn(), nextActions })} />);
    expect(screen.getByTestId('learning-next-actions')).toBeTruthy();
    expect(screen.getByTestId('learning-next-action-review_prerequisite')).toBeTruthy();
    expect(screen.getByTestId('learning-next-action-advance_topic')).toBeTruthy();
    expect(screen.getByText('Review fractions')).toBeTruthy();
    expect(screen.getByText('Advance to decimals')).toBeTruthy();
    expect(screen.getByText('Next')).toBeTruthy();
  });

  it('PRESENT nextActions ⇒ renders Hindi labels under isHi=true (P7)', () => {
    _isHi = true;
    render(<ChatBubble {...baseProps({ onLearningAction: vi.fn(), nextActions })} />);
    expect(screen.getByText('भिन्न दोहराओ')).toBeTruthy();
    expect(screen.getByText('दशमलव पर बढ़ो')).toBeTruthy();
    expect(screen.getByText('आगे')).toBeTruthy(); // "Next"
  });

  it('nextActions chips are display-only (no onLearningAction dispatch on click)', () => {
    const onLearningAction = vi.fn();
    render(<ChatBubble {...baseProps({ onLearningAction, nextActions })} />);
    fireEvent.click(screen.getByTestId('learning-next-action-advance_topic'));
    expect(onLearningAction).not.toHaveBeenCalled();
  });

  it('subset + nextActions coexist (gated buttons AND the chip row)', () => {
    render(
      <ChatBubble
        {...baseProps({ onLearningAction: vi.fn(), suggestedButtons: ['got_it'], nextActions })}
      />,
    );
    expect(screen.getByTestId('learning-action-gotit')).toBeTruthy();
    expect(screen.queryByTestId('learning-action-quiz')).toBeNull();
    expect(screen.getByTestId('learning-next-actions')).toBeTruthy();
  });
});
