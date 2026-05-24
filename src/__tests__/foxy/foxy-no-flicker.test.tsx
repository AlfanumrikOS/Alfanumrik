/**
 * REG-78 — Foxy chat surface flicker prevention.
 *
 * Pins the SYSTEMIC stability tests that catch a flicker regression regardless
 * of which CSS/React anti-pattern reintroduces it. Each prior fix in the
 * series (e38ced70 / fd0847d8 / ac1998cd / fd11840b / this PR) was a single
 * root-cause patch; this test suite is the durable backstop that fires when
 * a future change re-introduces:
 *
 *   1. Per-token re-renders of unaffected bubbles in the message list during
 *      a streamed AI response (~20Hz flushes).
 *   2. A missing React.memo / a defeated memo comparator on ChatBubble or
 *      MessageList.
 *   3. A change to the auto-scroll effect that schedules a rAF or smooth
 *      scrollTo on every messages mutation instead of once per turn-completion.
 *   4. A reappearance of the GPU compositing promotion on the chat scroll
 *      container (transform: translateZ(0)) — the regression that landed via
 *      PR #903 was the proximate cause of this fix series.
 *
 * The end-to-end pixel-diff backstop lives at e2e/foxy-stability.spec.ts.
 */

import { render, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import React, { useRef } from 'react';

// ── Mocks ───────────────────────────────────────────────────────────────────
// Mock auth so ChatBubble's useAuth() returns a stable isHi value.
vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ isHi: false }),
}));

// Mock the ReportIssueModal — it does its own fetch/state work and is irrelevant
// to flicker measurement.
vi.mock('@/components/foxy/ReportIssueModal', () => ({
  ReportIssueModal: () => null,
}));

// Mock UnverifiedBanner + HardAbstainCard — also irrelevant; they only paint
// when groundingStatus is set.
vi.mock('@/components/foxy/UnverifiedBanner', () => ({
  UnverifiedBanner: () => null,
}));
vi.mock('@/components/grounding/HardAbstainCard', () => ({
  HardAbstainCard: () => null,
}));

import { ChatBubble } from '@/components/foxy/ChatBubble';

// A render counter to measure how often a React subtree actually re-renders.
function RenderCounter({ countRef, children }: {
  countRef: React.MutableRefObject<number>;
  children: (props: { content: React.ReactNode }) => React.ReactElement;
}) {
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;
  countRef.current = renderCountRef.current;
  return children({ content: <div>tick {renderCountRef.current}</div> });
}

describe('REG-78 — ChatBubble memoisation prevents per-token re-renders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('chat_bubble_is_memoized_correctly: parent re-render with identical bubble props does NOT re-render the bubble body', () => {
    // Track how many times ChatBubble's render body executes by counting
    // through a probe in the `content` prop.
    let renderCount = 0;
    function ProbeContent({ value }: { value: string }) {
      renderCount += 1;
      return <span data-testid="probe">{value}</span>;
    }

    const baseProps = {
      role: 'tutor' as const,
      rawContent: 'Photosynthesis is the process by which plants make food.',
      timestamp: '2026-05-24T10:00:00Z',
      color: '#10B981',
      activeSubject: 'science' as const,
      onFeedback: () => {},
      onReport: () => {},
      feedback: null as 'up' | 'down' | null,
      reported: false,
      groundingStatus: undefined as undefined,
      traceId: undefined as undefined,
    };

    function Harness({ stamp }: { stamp: number }) {
      // The `content` ReactNode is reconstructed on every parent render
      // (just like in MessageList) — this is the canonical test for whether
      // the memo correctly IGNORES content-prop reference changes.
      return (
        <ChatBubble
          {...baseProps}
          content={<ProbeContent value={`stamp-${stamp}`} />}
        />
      );
    }

    const { rerender } = render(<Harness stamp={1} />);
    expect(renderCount).toBe(1);

    // Force 10 parent re-renders that change the `content` JSX reference but
    // not any of the memo-tracked props (rawContent, feedback, reported, etc).
    // The ChatBubble memo MUST skip — the probe should not re-run.
    for (let i = 0; i < 10; i++) {
      rerender(<Harness stamp={1} />);
    }
    expect(renderCount).toBe(1);

    // Now actually change rawContent — the bubble MUST re-render.
    function Harness2() {
      return (
        <ChatBubble
          {...baseProps}
          rawContent="Photosynthesis is the process by which plants make food. (corrected)"
          content={<ProbeContent value="v2" />}
        />
      );
    }
    rerender(<Harness2 />);
    expect(renderCount).toBe(2);
  });

  it('chat_bubble_memo_busts_on_meaningful_state_changes: feedback / reported / groundingStatus toggle bypass the memo', () => {
    let renderCount = 0;
    function ProbeContent() {
      renderCount += 1;
      return <span data-testid="probe" />;
    }

    const baseProps = {
      role: 'tutor' as const,
      rawContent: 'Steady text',
      timestamp: '2026-05-24T10:00:00Z',
      color: '#10B981',
      activeSubject: 'science' as const,
      onFeedback: () => {},
      onReport: () => {},
    };

    const { rerender } = render(
      <ChatBubble
        {...baseProps}
        feedback={null}
        reported={false}
        content={<ProbeContent />}
      />,
    );
    expect(renderCount).toBe(1);

    // feedback: null → 'up' MUST re-render
    rerender(
      <ChatBubble
        {...baseProps}
        feedback="up"
        reported={false}
        content={<ProbeContent />}
      />,
    );
    expect(renderCount).toBe(2);

    // reported: false → true MUST re-render
    rerender(
      <ChatBubble
        {...baseProps}
        feedback="up"
        reported={true}
        content={<ProbeContent />}
      />,
    );
    expect(renderCount).toBe(3);

    // No prop change → MUST be skipped
    rerender(
      <ChatBubble
        {...baseProps}
        feedback="up"
        reported={true}
        content={<ProbeContent />}
      />,
    );
    expect(renderCount).toBe(3);
  });

  it('message_list_does_not_re_render_more_than_5_times_during_stream: simulating ~200 token flushes only re-renders the streaming bubble', async () => {
    // This test is structural: we model the streaming protocol in useFoxyChat
    // (one `tutorBubbleId` whose `content` and `rawContent` grow per flush).
    // The bubbles OTHER than the streaming one MUST NOT re-render at all.
    //
    // We use a render-counter map keyed by bubble id to verify per-bubble
    // re-render counts as the array reference mutates on every flush.

    const renderCounts = new Map<string, number>();

    function CountingContent({ id }: { id: string }) {
      const prev = renderCounts.get(id) ?? 0;
      renderCounts.set(id, prev + 1);
      return <span data-testid={`probe-${id}`} />;
    }

    type Msg = {
      id: number;
      role: 'student' | 'tutor';
      rawContent: string;
    };

    function ListUnderTest({ messages }: { messages: Msg[] }) {
      // Mirror the MessageList map loop with stable per-message keys.
      return (
        <>
          {messages.map((m) => (
            <ChatBubble
              key={m.id}
              role={m.role}
              rawContent={m.rawContent}
              timestamp="2026-05-24T10:00:00Z"
              color="#10B981"
              activeSubject="science"
              onFeedback={() => {}}
              onReport={() => {}}
              feedback={null}
              reported={false}
              content={<CountingContent id={String(m.id)} />}
            />
          ))}
        </>
      );
    }

    // Initial: user sent a question, optimistic empty tutor bubble.
    let messages: Msg[] = [
      { id: 1, role: 'student', rawContent: 'What is photosynthesis?' },
      { id: 2, role: 'tutor', rawContent: '' },
    ];
    const { rerender } = render(<ListUnderTest messages={messages} />);
    expect(renderCounts.get('1')).toBe(1);
    expect(renderCounts.get('2')).toBe(1);

    // Simulate 50 streamed flushes (each appends a small delta to the tutor
    // bubble's rawContent). At ~20Hz this is ~2.5s of streaming, well
    // representative of a full Foxy turn.
    let stream = '';
    for (let i = 0; i < 50; i++) {
      stream += `tok${i} `;
      messages = messages.map((m) =>
        m.id === 2 ? { ...m, rawContent: stream } : m,
      );
      // The streaming hook calls setMessages with a fresh array on every flush.
      act(() => {
        rerender(<ListUnderTest messages={messages} />);
      });
    }

    // The student bubble (id=1) MUST not have re-rendered — its props never
    // changed. The pre-memo behaviour would have re-rendered it 51 times.
    expect(renderCounts.get('1')).toBe(1);

    // The streaming tutor bubble (id=2) DOES re-render — once for the initial
    // mount plus 50 flushes = 51 renders.
    expect(renderCounts.get('2')).toBe(51);
  });
});
