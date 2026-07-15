/**
 * MessageList — component tests.
 *
 * Plan ref: docs/superpowers/plans/2026-05-09-student-quality-upgrade.md
 *           Task 4 (4.2 counterpart): write tests AFTER component exists
 *
 * Asserts the bounded contract:
 *   1. Renders student bubbles (with/without an attached image preview)
 *   2. Renders tutor bubbles (with the legacy markdown branch — most common
 *      historical persisted state)
 *   3. Empty state — no messages → component renders nothing actionable
 *   4. Save-to-flashcard button visible only on un-reported tutor messages
 *
 * Streaming and structured-renderer paths are exercised by other tests under
 * src/__tests__/foxy/. We mock both renderers to keep these tests cheap.
 */

import { render, waitFor } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';

vi.mock('@alfanumrik/ui/foxy/RichContent', () => ({
  RichContent: ({ content }: { content: string }) => (
    <div data-testid="rich-content">{content}</div>
  ),
  default: ({ content }: { content: string }) => (
    <div data-testid="rich-content-default">{content}</div>
  ),
}));
vi.mock('@alfanumrik/ui/foxy/FoxyStructuredRenderer', () => ({
  FoxyStructuredRenderer: () => <div data-testid="structured" />,
  default: () => <div data-testid="structured-default" />,
}));
vi.mock('@alfanumrik/ui/foxy/StructuredRenderBoundary', () => ({
  StructuredRenderBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@alfanumrik/ui/foxy/ChatBubble', () => {
  const ChatBubbleMock = ({
    role,
    content,
    onFeedback,
    onReport,
  }: {
    role: 'student' | 'tutor';
    content: React.ReactNode;
    onFeedback?: (isUp: boolean) => void;
    onReport?: () => void;
  }) => (
    <div data-testid={`bubble-${role}`}>
      {content}
      {role === 'tutor' && (
        <>
          <button data-testid="feedback-up" onClick={() => onFeedback?.(true)}>up</button>
          <button data-testid="report-btn" onClick={() => onReport?.()}>report</button>
        </>
      )}
    </div>
  );
  return {
    ChatBubble: ChatBubbleMock,
    default: ChatBubbleMock,
  };
});
vi.mock('@alfanumrik/lib/foxy/is-foxy-response', () => ({
  isFoxyResponse: () => false,
}));
vi.mock('@alfanumrik/lib/foxy/recover-from-text', () => ({
  recoverFoxyResponseFromText: () => null,
}));
vi.mock('@alfanumrik/lib/foxy/denormalize', () => ({
  denormalizeFoxyResponse: (x: unknown) => x,
}));
vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => ({ isHi: false }),
}));

import { MessageList } from '@/app/foxy/_components/MessageList';
import type { ChatMessage } from '@/app/foxy/_lib/foxy-types';

const baseProps = {
  collapsedAbove: null,
  onSetCollapsedAbove: vi.fn(),
  activeSubject: 'science',
  cfgColor: '#10B981',
  studentName: 'Ada',
  isHi: false,
  ttsSupported: false,
  savedMessageIds: new Set<number>(),
  onFeedback: vi.fn(),
  onReport: vi.fn(),
  onSaveFlashcard: vi.fn(),
};

const studentMsg: ChatMessage = {
  id: 1,
  role: 'student',
  content: 'What is photosynthesis?',
  timestamp: '2026-05-09T10:00:00Z',
};
const tutorMsg: ChatMessage = {
  id: 2,
  role: 'tutor',
  content: 'Photosynthesis is...',
  timestamp: '2026-05-09T10:00:01Z',
};

describe('MessageList', () => {
  it('renders student bubbles with their content', () => {
    const { getByTestId } = render(<MessageList {...baseProps} messages={[studentMsg]} />);
    const bubble = getByTestId('bubble-student');
    expect(bubble.textContent).toContain('What is photosynthesis?');
  });

  it('renders a directive-echo student message as a compact pill, not a re-echoed question', () => {
    // A learning-action re-send appends a student bubble carrying a `directive`
    // marker. MessageList must paint it as a compact intent PILL instead of a
    // normal student bubble echoing the full question (the "renders twice" fix).
    const directiveMsg: ChatMessage = {
      id: 3,
      role: 'student',
      content: '🔁 Explain simpler',
      directive: 'simplify',
      timestamp: '2026-05-09T10:00:02Z',
    };
    const { getByTestId, getAllByTestId } = render(
      <MessageList {...baseProps} messages={[studentMsg, directiveMsg]} />,
    );
    // The directive message is a pill…
    const pill = getByTestId('directive-echo-pill');
    expect(pill.textContent).toBe('🔁 Explain simpler');
    expect(pill.textContent).not.toContain('photosynthesis');
    // …and it did NOT also render through the normal student-bubble path: only
    // the real question (studentMsg) becomes a bubble-student.
    expect(getAllByTestId('bubble-student')).toHaveLength(1);
  });

  it('renders tutor bubbles with the legacy RichContent renderer (no structured)', async () => {
    const { getByTestId } = render(<MessageList {...baseProps} messages={[tutorMsg]} />);
    // RichContent is loaded via next/dynamic, so wait for the async chunk
    // to resolve before asserting on its rendered content.
    await waitFor(() => {
      const bubble = getByTestId('bubble-tutor');
      expect(bubble.textContent).toContain('Photosynthesis is...');
    });
  });

  it('empty messages — renders no bubble and no collapsing button', () => {
    const { container, queryByTestId } = render(
      <MessageList {...baseProps} messages={[]} />,
    );
    expect(queryByTestId('bubble-student')).toBeNull();
    expect(queryByTestId('bubble-tutor')).toBeNull();
    // No "Show only recent" button (only appears when >10 messages)
    expect(container.querySelector('button')).toBeNull();
  });

  it('shows Save button on un-reported tutor messages and hides it on reported ones', () => {
    const reportedMsg: ChatMessage = { ...tutorMsg, id: 3, reported: true };
    const { getAllByText, queryByText } = render(
      <MessageList {...baseProps} messages={[tutorMsg, reportedMsg]} />,
    );
    // Save button text in EN: "📌 Save"
    const saveButtons = getAllByText(/📌 Save/);
    // Exactly ONE Save button — for the un-reported tutor message
    expect(saveButtons).toHaveLength(1);

    // Reported messages should not show Save
    // (already implicitly proven by the count above)
    expect(queryByText(/✓ Saved/)).toBeNull();
  });
});
