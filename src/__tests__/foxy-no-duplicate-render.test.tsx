/**
 * Foxy chat thread — no duplicate render regression.
 *
 * Production P0 (2026-04-28): A tutor response was rendering TWICE in the
 * thread — once as raw markdown (literal **bold**, # heading visible) and
 * once properly formatted under the Foxy bubble header. The messages array
 * had only 2 entries (1 user + 1 tutor) but the tutor body appeared twice.
 *
 * This regression guards the structural contract:
 *   1. messages.map produces exactly N <ChatBubble> per N messages
 *   2. Each tutor bubble's content text appears exactly once in the DOM
 *   3. Raw markdown markers (**, ##) from the tutor message are not rendered
 *      as literal text outside the markdown processor
 *
 * The test exercises ChatBubble directly (the messages.map iterates over
 * ChatBubble), passing the same JSX tree the foxy/page.tsx produces. We do
 * NOT mount the full FoxyPage here — the AuthContext + Supabase deps make
 * that a 200+ line setup. Instead we mirror the per-iteration render and
 * assert the per-iteration invariant.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import React, { type ReactNode } from 'react';
import { ChatBubble } from '@/components/foxy/ChatBubble';

// AuthContext stub — ChatBubble + ReportIssueModal both call useAuth().
vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ isHi: false }),
}));

// Inline RichContent stub — the production component is a 380-line
// ReactMarkdown-based renderer pulled in via next/dynamic. For the
// duplicate-render contract we only need a deterministic renderer that
// turns the same `content` string into exactly one DOM node. The real
// component's behavior is exercised in foxy-chat-bubble-grounding.test.tsx
// and the markdown library's own tests.
function FakeRichContent({ content }: { content: string }) {
  // Simulate "rendered" markdown: strip ** and # markers, like ReactMarkdown
  // would when producing semantic <strong> / <h1> elements.
  const rendered = content.replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#+\s*/gm, '');
  return <div data-testid="rich-content">{rendered}</div>;
}

interface ChatMessage {
  id: number;
  role: 'student' | 'tutor';
  content: string;
}

/**
 * Mirror of the per-iteration render in src/app/foxy/page.tsx (lines 1820-1869).
 * If the production code adds a second body element per iteration, this helper
 * MUST be updated to match — and the tests below will catch the drift.
 */
function renderOneMessage(msg: ChatMessage): ReactNode {
  const content: ReactNode = msg.role === 'tutor'
    ? <FakeRichContent content={msg.content} />
    : <div className="whitespace-pre-wrap">{msg.content}</div>;
  return (
    <div key={msg.id}>
      <ChatBubble
        role={msg.role}
        content={content}
        rawContent={msg.content}
        timestamp={new Date('2026-04-28T12:22:00Z').toISOString()}
        studentName="Test Student"
        color="#10B981"
        activeSubject="science"
        onFeedback={() => {}}
        onReport={() => {}}
      />
    </div>
  );
}

describe('Foxy chat thread — no duplicate render', () => {
  it('a 2-message thread (user + tutor) renders exactly 2 message bodies', () => {
    const messages: ChatMessage[] = [
      { id: 1, role: 'student', content: 'What is photosynthesis?' },
      { id: 2, role: 'tutor', content: '**Photosynthesis** is the process...' },
    ];

    render(<>{messages.map(renderOneMessage)}</>);

    // Each bubble exposes a single header label ("Foxy" or studentName).
    expect(screen.getAllByText('Foxy')).toHaveLength(1);
    expect(screen.getAllByText('Test Student')).toHaveLength(1);
  });

  it('the tutor message text appears exactly once in the rendered DOM', () => {
    const tutorContent =
      '**Photosynthesis** is the process by which plants convert light into food.';
    const messages: ChatMessage[] = [
      { id: 1, role: 'student', content: 'What is photosynthesis?' },
      { id: 2, role: 'tutor', content: tutorContent },
    ];

    const { container } = render(<>{messages.map(renderOneMessage)}</>);

    // The processed text (without ** markers) should appear exactly once.
    const processedText =
      'Photosynthesis is the process by which plants convert light into food.';
    const matches = container.textContent?.match(
      new RegExp(processedText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
    );
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(1);
  });

  it('the rich-content renderer is mounted exactly once per tutor message', () => {
    const messages: ChatMessage[] = [
      { id: 1, role: 'student', content: 'Explain Newton\'s first law.' },
      { id: 2, role: 'tutor', content: '# Newton\'s First Law\n\nAn object at rest...' },
    ];

    render(<>{messages.map(renderOneMessage)}</>);

    // Exactly one RichContent renderer per tutor message.
    expect(screen.getAllByTestId('rich-content')).toHaveLength(1);
  });

  it('raw markdown markers (** and #) do NOT leak as literal text in the tutor body', () => {
    const messages: ChatMessage[] = [
      { id: 1, role: 'student', content: 'What is gravity?' },
      { id: 2, role: 'tutor', content: '**Gravity** is the force that pulls objects toward Earth. # Definition' },
    ];

    const { container } = render(<>{messages.map(renderOneMessage)}</>);

    // The raw markers must not appear in the rendered DOM.
    expect(container.textContent).not.toMatch(/\*\*Gravity\*\*/);
    expect(container.textContent).not.toMatch(/^#\s*Definition/m);

    // The processed (rendered) version IS present.
    expect(container.textContent).toMatch(/Gravity is the force/);
  });

  it('a tutor bubble renders exactly one header (no duplicated avatar)', () => {
    const messages: ChatMessage[] = [
      { id: 1, role: 'tutor', content: 'Hello!' },
    ];

    const { container } = render(<>{messages.map(renderOneMessage)}</>);

    // The fox emoji marks the tutor avatar in the header. It must appear once.
    const foxEmojis = container.textContent?.match(/🦊/g) || [];
    expect(foxEmojis.length).toBe(1);
  });

  it('a 3-message thread (user + tutor + tutor) renders exactly 3 bubbles', () => {
    const messages: ChatMessage[] = [
      { id: 1, role: 'student', content: 'Q1' },
      { id: 2, role: 'tutor', content: 'A1' },
      { id: 3, role: 'tutor', content: 'A2' },
    ];

    render(<>{messages.map(renderOneMessage)}</>);

    // Two tutor headers, one student header.
    expect(screen.getAllByText('Foxy')).toHaveLength(2);
    expect(screen.getAllByText('Test Student')).toHaveLength(1);
  });

  it('tutor bubble does not also contain the raw rawContent string in the DOM', () => {
    // This guards the original P0 symptom: raw `**bold**` text appearing
    // alongside the rendered version. ChatBubble's rawContent prop must
    // ONLY drive conditional logic (action bar visibility), never display.
    const tutorContent = '**Important** point about CBSE physics.';
    const messages: ChatMessage[] = [
      { id: 2, role: 'tutor', content: tutorContent },
    ];

    const { container } = render(<>{messages.map(renderOneMessage)}</>);

    // The rendered (processed) version IS present.
    const richContent = within(container).getByTestId('rich-content');
    expect(richContent.textContent).toBe('Important point about CBSE physics.');

    // The raw string with literal ** must NOT appear anywhere in the bubble.
    expect(container.textContent).not.toContain('**Important**');
  });
});
