import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';

/**
 * MessageList — the `hasRenderableBody` computation that feeds ChatBubble's
 * `hasBodyContent` prop (empty-bubble suppression, page half).
 *
 * A tutor turn has a renderable body iff it carries structured content, OR
 * non-whitespace text, OR a ui_action payload. A genuinely-empty tutor turn
 * (settled with no text, no structured, no ui_action) is flagged
 * hasBodyContent=false so ChatBubble drops the empty box. Student turns are
 * ALWAYS renderable.
 *
 * We mock ChatBubble to surface the computed prop as `data-has-body` so the
 * decision is asserted directly, independent of ChatBubble's own rendering.
 */

vi.mock('@alfanumrik/ui/foxy/ChatBubble', () => {
  const Mock = ({
    role,
    content,
    hasBodyContent,
  }: {
    role: 'student' | 'tutor';
    content: React.ReactNode;
    hasBodyContent?: boolean;
  }) => (
    <div data-testid={`bubble-${role}`} data-has-body={String(hasBodyContent)}>
      {content}
    </div>
  );
  return { ChatBubble: Mock, default: Mock };
});
vi.mock('@alfanumrik/ui/foxy/RichContent', () => ({
  RichContent: ({ content }: { content: string }) => <div data-testid="rich">{content}</div>,
  default: ({ content }: { content: string }) => <div>{content}</div>,
}));
vi.mock('@alfanumrik/ui/foxy/FoxyStructuredRenderer', () => ({
  FoxyStructuredRenderer: () => <div data-testid="structured" />,
  default: () => <div />,
}));
vi.mock('@alfanumrik/ui/foxy/StructuredRenderBoundary', () => ({
  StructuredRenderBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/app/foxy/_components/DynamicScaffold', () => ({
  default: () => <div data-testid="scaffold" />,
}));
// A `structured` payload counts as real only when isFoxyResponse says so. Return
// true → a message carrying `structured` is treated as a structured turn. It is
// only consulted when `structured` is truthy (short-circuit), so the other cases
// are unaffected.
vi.mock('@alfanumrik/lib/foxy/is-foxy-response', () => ({ isFoxyResponse: () => true }));
vi.mock('@alfanumrik/lib/foxy/recover-from-text', () => ({ recoverFoxyResponseFromText: () => null }));
vi.mock('@alfanumrik/lib/foxy/denormalize', () => ({ denormalizeFoxyResponse: (x: unknown) => x }));
vi.mock('@alfanumrik/lib/AuthContext', () => ({ useAuth: () => ({ isHi: false }) }));

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

function bodyFlag(container: HTMLElement, role: 'tutor' | 'student') {
  return container
    .querySelector(`[data-testid="bubble-${role}"]`)
    ?.getAttribute('data-has-body');
}

beforeEach(() => cleanup());

describe('MessageList — hasRenderableBody → hasBodyContent', () => {
  it('non-empty tutor text → hasBodyContent true', () => {
    const msg: ChatMessage = {
      id: 1,
      role: 'tutor',
      content: 'Photosynthesis converts light into chemical energy.',
      timestamp: '2026-07-14T10:00:00Z',
    };
    const { container } = render(<MessageList {...baseProps} messages={[msg]} />);
    expect(bodyFlag(container, 'tutor')).toBe('true');
  });

  it('structured "Quiz me" tutor turn with EMPTY text → still hasBodyContent true (never suppressed)', () => {
    const msg: ChatMessage = {
      id: 2,
      role: 'tutor',
      content: '',
      timestamp: '2026-07-14T10:00:00Z',
      // A structured payload (e.g. an evidential Quiz-me MCQ) with no prose body.
      structured: { blocks: [] } as never,
    };
    const { container } = render(<MessageList {...baseProps} messages={[msg]} />);
    expect(bodyFlag(container, 'tutor')).toBe('true');
  });

  it('tutor turn carrying only a ui_action payload → hasBodyContent true', () => {
    const msg: ChatMessage = {
      id: 3,
      role: 'tutor',
      content: '```json\n{"ui_action":"quiz"}\n```',
      timestamp: '2026-07-14T10:00:00Z',
    };
    const { container } = render(<MessageList {...baseProps} messages={[msg]} />);
    expect(bodyFlag(container, 'tutor')).toBe('true');
  });

  it('genuinely empty tutor turn (only whitespace, no structured, no ui_action) → hasBodyContent false', () => {
    const msg: ChatMessage = {
      id: 4,
      role: 'tutor',
      content: '   ',
      timestamp: '2026-07-14T10:00:00Z',
    };
    const { container } = render(<MessageList {...baseProps} messages={[msg]} />);
    expect(bodyFlag(container, 'tutor')).toBe('false');
  });

  it('student turns are always renderable — hasBodyContent true even with empty content', () => {
    const msg: ChatMessage = {
      id: 5,
      role: 'student',
      content: '',
      timestamp: '2026-07-14T10:00:00Z',
    };
    const { container } = render(<MessageList {...baseProps} messages={[msg]} />);
    expect(bodyFlag(container, 'student')).toBe('true');
  });
});
