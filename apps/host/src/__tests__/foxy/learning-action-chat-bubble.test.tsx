import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';

/**
 * GUARD #8 (ChatBubble half) — the flag-gated post-answer action bar.
 *
 * Contract:
 *   - flag OFF (default): the legacy QA-tester bar renders (👍 / 👎 / ⚠️ Report
 *     + the "Report an issue" link). The NEW learning-action bar is ABSENT.
 *   - flag ON: the new bar renders; its chips dispatch onLearningAction with the
 *     correct actionType; legacy thumbs/report are absent; labels are bilingual.
 *
 * The flag itself is a prop (`learningActionsEnabled`) — the page reads
 * useFoxyLearningActionsFlag() and passes it down, so ChatBubble's contract is
 * "given the flag value, render the right bar". We test both prop values.
 */

let _isHi = false;
vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => ({ isHi: _isHi }),
}));
// ReportIssueModal pulls supabase; stub so the module graph resolves.
vi.mock('@alfanumrik/ui/foxy/ReportIssueModal', () => ({
  ReportIssueModal: () => null,
}));

import ChatBubble from '@alfanumrik/ui/foxy/ChatBubble';

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    role: 'tutor' as const,
    content: <div>The mitochondria is the powerhouse of the cell.</div>,
    rawContent: 'The mitochondria is the powerhouse of the cell.',
    timestamp: '2026-06-14T12:00:00.000Z',
    color: '#10B981',
    activeSubject: 'science',
    onFeedback: vi.fn(),
    onReport: vi.fn(),
    messageId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    ...overrides,
  };
}

beforeEach(() => {
  cleanup();
  _isHi = false;
});

describe('GUARD #8 — ChatBubble flag OFF (legacy bar, byte-identical)', () => {
  it('renders the legacy thumbs + Report + report-issue link; new bar absent', () => {
    render(<ChatBubble {...baseProps({ learningActionsEnabled: false })} />);
    // Legacy controls present.
    expect(screen.getByLabelText('Helpful response')).toBeTruthy();
    expect(screen.getByLabelText('Not helpful response')).toBeTruthy();
    expect(screen.getByLabelText('Report incorrect response')).toBeTruthy();
    expect(screen.getByTestId('report-issue-link')).toBeTruthy();
    // New learning-action bar absent.
    expect(screen.queryByTestId('learning-action-gotit')).toBeNull();
    expect(screen.queryByTestId('learning-action-quiz')).toBeNull();
    expect(screen.queryByTestId('learning-action-overflow')).toBeNull();
  });

  it('flag OFF + onLearningAction provided: still renders ONLY the legacy bar (prop alone never flips the UI)', () => {
    const onLearningAction = vi.fn();
    render(<ChatBubble {...baseProps({ learningActionsEnabled: false, onLearningAction })} />);
    expect(screen.queryByTestId('learning-action-gotit')).toBeNull();
    expect(screen.getByLabelText('Helpful response')).toBeTruthy();
  });
});

describe('GUARD #8 — ChatBubble flag ON (new learning-action bar)', () => {
  it('renders compact primary actions; secondary learning actions live in overflow', () => {
    render(<ChatBubble {...baseProps({ learningActionsEnabled: true, onLearningAction: vi.fn() })} />);
    expect(screen.getByTestId('learning-action-gotit')).toBeTruthy();
    expect(screen.getByTestId('learning-action-overflow')).toBeTruthy();
    expect(screen.queryByTestId('learning-action-simpler')).toBeNull();
    expect(screen.queryByTestId('learning-action-example')).toBeNull();
    expect(screen.queryByTestId('learning-action-quiz')).toBeNull();
    fireEvent.click(screen.getByTestId('learning-action-overflow'));
    expect(screen.getByTestId('learning-action-simpler')).toBeTruthy();
    expect(screen.getByTestId('learning-action-example')).toBeTruthy();
    expect(screen.getByTestId('learning-action-quiz')).toBeTruthy();
    // Legacy controls gone.
    expect(screen.queryByLabelText('Helpful response')).toBeNull();
    expect(screen.queryByTestId('report-issue-link')).toBeNull();
  });

  it('Got it ✓ dispatches onLearningAction("got_it")', () => {
    const onLearningAction = vi.fn();
    render(<ChatBubble {...baseProps({ learningActionsEnabled: true, onLearningAction })} />);
    fireEvent.click(screen.getByTestId('learning-action-gotit'));
    expect(onLearningAction).toHaveBeenCalledWith('got_it');
  });

  it('Explain simpler dispatches "explain_simpler"; Show example dispatches "show_example"', () => {
    const onLearningAction = vi.fn();
    render(<ChatBubble {...baseProps({ learningActionsEnabled: true, onLearningAction })} />);
    fireEvent.click(screen.getByTestId('learning-action-overflow'));
    fireEvent.click(screen.getByTestId('learning-action-simpler'));
    expect(onLearningAction).toHaveBeenLastCalledWith('explain_simpler');
    fireEvent.click(screen.getByTestId('learning-action-overflow'));
    fireEvent.click(screen.getByTestId('learning-action-example'));
    expect(onLearningAction).toHaveBeenLastCalledWith('show_example');
  });

  it('Quiz me on this dispatches "quiz_me"', () => {
    const onLearningAction = vi.fn();
    render(<ChatBubble {...baseProps({ learningActionsEnabled: true, onLearningAction })} />);
    fireEvent.click(screen.getByTestId('learning-action-overflow'));
    fireEvent.click(screen.getByTestId('learning-action-quiz'));
    expect(onLearningAction).toHaveBeenCalledWith('quiz_me');
  });

  it('Save (in the overflow menu) dispatches "save"', () => {
    const onLearningAction = vi.fn();
    render(<ChatBubble {...baseProps({ learningActionsEnabled: true, onLearningAction })} />);
    fireEvent.click(screen.getByTestId('learning-action-overflow'));
    fireEvent.click(screen.getByTestId('learning-action-save'));
    expect(onLearningAction).toHaveBeenCalledWith('save');
  });

  it('gotIt=true collapses the row into the micro-CTA (no chips, no extra dispatch)', () => {
    const onLearningAction = vi.fn();
    render(<ChatBubble {...baseProps({ learningActionsEnabled: true, onLearningAction, gotIt: true })} />);
    expect(screen.getByTestId('learning-action-gotit-confirm')).toBeTruthy();
    expect(screen.queryByTestId('learning-action-gotit')).toBeNull();
  });

  it('renders English chip labels under isHi=false', () => {
    render(<ChatBubble {...baseProps({ learningActionsEnabled: true, onLearningAction: vi.fn() })} />);
    expect(screen.getByText(/Got it/)).toBeTruthy();
    fireEvent.click(screen.getByTestId('learning-action-overflow'));
    expect(screen.getByText('Explain simpler')).toBeTruthy();
    expect(screen.getByText('Show example')).toBeTruthy();
    expect(screen.getByText('Quiz me on this')).toBeTruthy();
  });

  it('renders bilingual (Hindi) chip labels under isHi=true', () => {
    _isHi = true;
    render(<ChatBubble {...baseProps({ learningActionsEnabled: true, onLearningAction: vi.fn() })} />);
    expect(screen.getByText(/समझ गया/)).toBeTruthy();       // Got it
    fireEvent.click(screen.getByTestId('learning-action-overflow'));
    expect(screen.getByText('आसान करके बताओ')).toBeTruthy();  // Explain simpler
    expect(screen.getByText('उदाहरण दिखाओ')).toBeTruthy();    // Show example
    expect(screen.getByText('इस पर क्विज़ लो')).toBeTruthy();  // Quiz me on this
  });

  it('the error fallback bubble shows NO learning-action bar even when flag ON', () => {
    render(
      <ChatBubble
        {...baseProps({ learningActionsEnabled: true, onLearningAction: vi.fn(), content: <div>Oops! Please try again.</div>, rawContent: 'Oops! Please try again.' })}
      />,
    );
    expect(screen.queryByTestId('learning-action-gotit')).toBeNull();
  });
});
