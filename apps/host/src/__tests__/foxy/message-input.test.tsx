/**
 * MessageInput — component tests.
 *
 * Plan ref: docs/superpowers/plans/2026-05-09-student-quality-upgrade.md
 *           Task 5a: extract message-input UI; tests follow extraction.
 *
 * Asserts the bounded contract of the component itself:
 *   1. Long-conversation nudge appears at >= 15 student turns
 *   2. Nudge does NOT appear with <15 student turns
 *   3. The "New Chat" button in the nudge calls onNewConversation
 *   4. The composer area renders (delegated to mocked ChatInput)
 *
 * The actual textarea, math symbols, voice button, and image upload
 * live inside `<ChatInput>` and are covered by their own tests; we
 * mock that surface here.
 */

import { render, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';

vi.mock('@alfanumrik/ui/foxy/ChatInput', () => ({
  ChatInput: ({ onSubmit }: { onSubmit: (text: string) => void }) => (
    <div data-testid="chat-input">
      <button data-testid="send" onClick={() => onSubmit('hello')}>send</button>
    </div>
  ),
}));

import { MessageInput } from '@/app/foxy/_components/MessageInput';
import type { ChatMessage } from '@/app/foxy/_lib/foxy-types';

const baseProps = {
  language: 'en',
  isHi: false,
  loading: false,
  voiceMode: false,
  activeSubject: 'science',
  onSend: vi.fn(),
  onNewConversation: vi.fn(),
};

const mkStudentMsgs = (n: number): ChatMessage[] =>
  Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    role: 'student' as const,
    content: `q${i}`,
    timestamp: new Date().toISOString(),
  }));

describe('MessageInput', () => {
  it('shows the long-conversation nudge at >= 15 student turns', () => {
    const { getByText } = render(
      <MessageInput {...baseProps} messages={mkStudentMsgs(15)} />,
    );
    expect(getByText(/Start a new chat so Foxy/)).toBeTruthy();
  });

  it('hides the nudge when there are fewer than 15 student turns', () => {
    const { queryByText } = render(
      <MessageInput {...baseProps} messages={mkStudentMsgs(10)} />,
    );
    expect(queryByText(/Start a new chat so Foxy/)).toBeNull();
  });

  it('clicking the nudge "New Chat" button fires onNewConversation', () => {
    const onNewConversation = vi.fn();
    const { getByText } = render(
      <MessageInput
        {...baseProps}
        onNewConversation={onNewConversation}
        messages={mkStudentMsgs(20)}
      />,
    );
    fireEvent.click(getByText('New Chat'));
    expect(onNewConversation).toHaveBeenCalledTimes(1);
  });

  it('forwards send events from the composer to onSend', () => {
    const onSend = vi.fn();
    const { getByTestId } = render(
      <MessageInput {...baseProps} onSend={onSend} messages={[]} />,
    );
    fireEvent.click(getByTestId('send'));
    expect(onSend).toHaveBeenCalledWith('hello');
  });
});
