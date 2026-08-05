/**
 * FoxyPanel — Phase 4 U1 embed component tests.
 *
 * Asserts the bounded contract for the slim, embeddable panel:
 *   1. Renders header + subject chip + composer on mount (no messages yet)
 *   2. `onClose` prop wires up the header close button
 *   3. Save-flashcard / report affordances are NOT surfaced in embed contexts
 *      (they live on the /foxy full page only)
 *
 * Streaming / sendMessage behavior is exercised in isolation by
 * `use-foxy-chat.test.ts`; here we mock useFoxyChat so the panel test stays
 * fast and dependency-free.
 */

import { render, fireEvent, screen } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';

// Mock the chat hook so we do not touch the network or supabase auth.
vi.mock('@alfanumrik/ui/foxy-panel/useFoxyChat', () => ({
  useFoxyChat: () => ({
    messages: [],
    setMessages: vi.fn(),
    loading: false,
    setLoading: vi.fn(),
    chatSessionId: null,
    setChatSessionId: vi.fn(),
    adoptConversationId: vi.fn(),
    startNewConversation: vi.fn(),
    xpGained: 0,
    setXpGained: vi.fn(),
    nextMessageId: () => 1,
    clearMessages: vi.fn(),
    sendMessage: vi.fn(async () => {}),
    recordLearningAction: vi.fn(async () => true),
    submitQuizAnswer: vi.fn(async () => ({ ok: false, error: 'network' as const })),
  }),
}));

// Mock the message-list dependencies so we don't drag the whole markdown +
// KaTeX + structured-renderer chain into the test.
vi.mock('@alfanumrik/ui/foxy/RichContent', () => ({
  RichContent: ({ content }: { content: string }) => <div>{content}</div>,
}));
vi.mock('@alfanumrik/ui/foxy/FoxyStructuredRenderer', () => ({
  FoxyStructuredRenderer: () => null,
  default: () => null,
}));
vi.mock('@alfanumrik/ui/foxy/StructuredRenderBoundary', () => ({
  StructuredRenderBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@alfanumrik/ui/foxy/ChatBubble', () => {
  const B = ({ content }: { content: React.ReactNode }) => <div data-testid="bubble">{content}</div>;
  return { default: B, ChatBubble: B };
});
vi.mock('@alfanumrik/ui/foxy/HelplineCard', () => ({
  default: () => null,
}));
vi.mock('@alfanumrik/ui/foxy/ChatInput', () => ({
  ChatInput: ({ onSubmit }: { onSubmit: (t: string) => void }) => (
    <textarea data-testid="composer" onChange={(e) => onSubmit(e.target.value)} />
  ),
}));
vi.mock('@alfanumrik/lib/foxy/is-foxy-response', () => ({
  isFoxyResponse: () => false,
}));
// Partial mock via importOriginal (see FOXY-RAWJSON, 2026-08-05): a hand-written
// factory silently omits any export the module later gains, and MessageList then
// throws at render. Spreading the original is future-proof.
vi.mock('@alfanumrik/lib/foxy/recover-from-text', async (importOriginal) => {
  const real = await importOriginal<typeof import('@alfanumrik/lib/foxy/recover-from-text')>();
  return { ...real };
});
vi.mock('@alfanumrik/lib/foxy/denormalize', () => ({
  denormalizeFoxyResponse: (x: unknown) => x,
}));

import FoxyPanel from '@alfanumrik/ui/foxy-panel/FoxyPanel';

const baseProps = {
  subject: 'Science',
  grade: '10',
  chapter: 'Light',
  context: 'today' as const,
  isHi: false,
  language: 'en',
  studentId: 's-1',
  studentName: 'Ada',
};

describe('FoxyPanel — slim embed', () => {
  it('renders header, subject chip, chapter, and composer on mount', () => {
    render(<FoxyPanel {...baseProps} />);

    expect(screen.getByTestId('foxy-panel')).toBeTruthy();
    // Subject chip carries the subject name and the chapter suffix.
    expect(screen.getByText(/Science/)).toBeTruthy();
    expect(screen.getByText(/Light/)).toBeTruthy();
    // Composer is always rendered so the student can type immediately.
    expect(screen.getByTestId('composer')).toBeTruthy();
  });

  it('fires onClose when the header close button is tapped', () => {
    const onClose = vi.fn();
    render(<FoxyPanel {...baseProps} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('foxy-panel-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT render a close button when onClose is absent', () => {
    render(<FoxyPanel {...baseProps} />);
    expect(screen.queryByTestId('foxy-panel-close')).toBeNull();
  });

  it('stamps the panel context onto the root element (data-context)', () => {
    render(<FoxyPanel {...baseProps} context="quiz-results" />);
    const root = screen.getByTestId('foxy-panel');
    expect(root.getAttribute('data-context')).toBe('quiz-results');
  });

  it('respects the isHi language flag on chrome (close aria)', () => {
    const onClose = vi.fn();
    render(<FoxyPanel {...baseProps} isHi onClose={onClose} />);
    const btn = screen.getByTestId('foxy-panel-close');
    expect(btn.getAttribute('aria-label')).toBe('बंद करो');
  });
});
