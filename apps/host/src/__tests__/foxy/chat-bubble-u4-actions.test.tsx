/**
 * ChatBubble — U4 coaching actions (Foxy North-Star Phase 3).
 *
 * Pins that the two new post-answer chips ('give_hint' | 'let_me_try')
 * render inside the learning-action bar and dispatch the correct action
 * type via onLearningAction. Telemetry-only per the /api/foxy/learning-action
 * binding contract (no XP / no mastery on this route).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';

let _isHi = false;
vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => ({ isHi: _isHi }),
}));
vi.mock('@alfanumrik/ui/foxy/ReportIssueModal', () => ({ ReportIssueModal: () => null }));

import ChatBubble from '@alfanumrik/ui/foxy/ChatBubble';

function tutorProps(overrides: Record<string, unknown> = {}) {
  return {
    role: 'tutor' as const,
    content: <div>Answer body.</div>,
    rawContent: 'Answer body.',
    timestamp: '2026-08-05T12:00:00.000Z',
    color: '#10B981',
    activeSubject: 'science',
    onFeedback: vi.fn(),
    onReport: vi.fn(),
    learningActionsEnabled: true,
    ...overrides,
  };
}

beforeEach(() => {
  cleanup();
  _isHi = false;
});

describe('ChatBubble — U4 coaching actions', () => {
  it('renders give_hint + let_me_try chips inside the learning-action bar', () => {
    render(<ChatBubble {...tutorProps({ onLearningAction: vi.fn() })} />);
    expect(screen.getByTestId('learning-action-give-hint')).toBeTruthy();
    expect(screen.getByTestId('learning-action-let-me-try')).toBeTruthy();
    expect(screen.getByText('Give me a hint')).toBeTruthy();
    expect(screen.getByText('Let me try')).toBeTruthy();
  });

  it('give_hint chip dispatches action type "give_hint"', () => {
    const onLearningAction = vi.fn();
    render(<ChatBubble {...tutorProps({ onLearningAction })} />);
    fireEvent.click(screen.getByTestId('learning-action-give-hint'));
    expect(onLearningAction).toHaveBeenCalledWith('give_hint');
  });

  it('let_me_try chip dispatches action type "let_me_try"', () => {
    const onLearningAction = vi.fn();
    render(<ChatBubble {...tutorProps({ onLearningAction })} />);
    fireEvent.click(screen.getByTestId('learning-action-let-me-try'));
    expect(onLearningAction).toHaveBeenCalledWith('let_me_try');
  });

  it('Hindi labels resolve when isHi=true', () => {
    _isHi = true;
    render(<ChatBubble {...tutorProps({ onLearningAction: vi.fn() })} />);
    expect(screen.getByText('एक संकेत दो')).toBeTruthy();
    expect(screen.getByText('मुझे कोशिश करने दो')).toBeTruthy();
  });
});
