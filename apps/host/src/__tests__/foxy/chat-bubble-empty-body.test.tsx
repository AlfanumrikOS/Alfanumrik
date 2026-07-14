import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';

/**
 * ChatBubble — empty-body suppression (`hasBodyContent`).
 *
 * Fixes the "blank white bubble" bug: a tutor turn that settled with no text
 * delta (streaming) or an empty persisted row used to paint an empty
 * `.foxy-bubble-tutor` box under the Foxy header. The bubble now renders the
 * body box only when `hasBodyContent || showBadge`.
 *
 * Contract:
 *   - hasBodyContent defaults to TRUE → every existing caller is byte-identical.
 *   - tutor + hasBodyContent=false + no badge → the body box is NOT rendered
 *     (no blank foxy-bubble-tutor bar). The header still renders.
 *   - A verifier badge forces the box open even when hasBodyContent=false, so a
 *     verified/out-of-scope math turn never loses its pill.
 */

let _isHi = false;
vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => ({ isHi: _isHi }),
}));
// ReportIssueModal pulls supabase; stub so the module graph resolves.
vi.mock('@alfanumrik/ui/foxy/ReportIssueModal', () => ({ ReportIssueModal: () => null }));

import ChatBubble from '@alfanumrik/ui/foxy/ChatBubble';

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    role: 'tutor' as const,
    content: <div>Real answer body.</div>,
    rawContent: 'Real answer body.',
    timestamp: '2026-07-14T12:00:00.000Z',
    color: '#10B981',
    activeSubject: 'science',
    onFeedback: vi.fn(),
    onReport: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  cleanup();
  _isHi = false;
});

describe('ChatBubble — hasBodyContent=false suppresses the empty tutor body box', () => {
  it('renders NO foxy-bubble-tutor box (and no content) when hasBodyContent=false and no badge', () => {
    const { container } = render(
      <ChatBubble
        {...baseProps({
          hasBodyContent: false,
          content: <div>this should be suppressed</div>,
          rawContent: 'this should be suppressed',
        })}
      />,
    );
    // The blank body box is gone.
    expect(container.querySelector('.foxy-bubble-tutor')).toBeNull();
    expect(screen.queryByText('this should be suppressed')).toBeNull();
    // The header (Foxy label) still renders — the frame is present, just no box.
    expect(screen.getByText('Foxy')).toBeTruthy();
  });

  it('renders the foxy-bubble-tutor box when content exists (default hasBodyContent=true)', () => {
    const { container } = render(<ChatBubble {...baseProps()} />);
    expect(container.querySelector('.foxy-bubble-tutor')).not.toBeNull();
    expect(screen.getByText('Real answer body.')).toBeTruthy();
  });

  it('a verifier badge forces the body box open even when hasBodyContent=false', () => {
    const { container } = render(
      <ChatBubble {...baseProps({ hasBodyContent: false, badgeState: 'verified' })} />,
    );
    // Box re-opens to host the badge...
    expect(container.querySelector('.foxy-bubble-tutor')).not.toBeNull();
    // ...and the Verified pill renders inside it.
    expect(screen.getByRole('status', { name: 'Verified' })).toBeTruthy();
  });

  it('student bubbles are unaffected — a student body box renders normally', () => {
    const { container } = render(
      <ChatBubble
        {...baseProps({
          role: 'student',
          studentName: 'Ada',
          content: <div>my question</div>,
          rawContent: 'my question',
        })}
      />,
    );
    expect(container.querySelector('.foxy-bubble-user')).not.toBeNull();
    expect(screen.getByText('my question')).toBeTruthy();
  });
});
