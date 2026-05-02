/**
 * Foxy chat — structured-rendering integration tests.
 *
 * These tests pin the renderer-choice contract that lives in
 * `src/app/foxy/page.tsx`:
 *
 *   1. Tutor message with a schema-valid `structured` payload renders via
 *      FoxyStructuredRenderer (data-testid="foxy-structured-renderer").
 *   2. Tutor message with no `structured` (legacy / abstain / pre-`done`
 *      streaming) falls back to RichContent (markdown rendering of `content`).
 *   3. If the structured renderer throws at runtime (malformed payload),
 *      `StructuredRenderBoundary` catches it and shows the legacy RichContent
 *      rendering of the same `content` string — the user always sees an
 *      answer.
 *
 * We don't load /foxy/page.tsx itself (huge file with Supabase + auth deps).
 * Instead we mirror its renderer-choice expression in a tiny harness so the
 * contract can be verified at the component layer. Any future refactor to
 * page.tsx must keep this exact predicate alive.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import type { FoxyResponse } from '@/lib/foxy/schema';
import { isFoxyResponse } from '@/lib/foxy/is-foxy-response';
import { StructuredRenderBoundary } from '@/components/foxy/StructuredRenderBoundary';

// ── Auth + subject lookup mocks ───────────────────────────────────────────────
// Both renderers consume these; mocking them keeps the test independent of the
// auth provider and the subjects service.

vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ isHi: false }),
}));

vi.mock('@/lib/useSubjectLookup', () => ({
  useSubjectLookup: () => () => ({
    code: 'science',
    icon: '⚛',
    color: '#10B981',
    name: 'Science',
  }),
}));

// Import after mocks — both renderers pull AuthContext at module-eval time.
import { FoxyStructuredRenderer } from '@/components/foxy/FoxyStructuredRenderer';
import { RichContent } from '@/components/foxy/RichContent';

// ── Test harness ──────────────────────────────────────────────────────────────
// Mirrors the renderer-choice expression from `src/app/foxy/page.tsx`. Keep
// this in lockstep with page.tsx — if the predicate diverges these tests must
// be updated.

interface TestMsg {
  role: 'student' | 'tutor';
  content: string;
  structured?: FoxyResponse;
}

function ChatBubbleHarness({ msg }: { msg: TestMsg }) {
  if (msg.role !== 'tutor') {
    return <div>{msg.content}</div>;
  }
  const useStructured = msg.structured && isFoxyResponse(msg.structured);
  const legacyTutorContent = (
    <RichContent content={msg.content} subjectKey="science" />
  );
  if (useStructured) {
    return (
      <StructuredRenderBoundary fallback={legacyTutorContent}>
        <FoxyStructuredRenderer
          response={msg.structured!}
          subjectKey="science"
        />
      </StructuredRenderBoundary>
    );
  }
  return legacyTutorContent;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Tutor with structured payload → FoxyStructuredRenderer
// ─────────────────────────────────────────────────────────────────────────────

describe('Foxy chat renderer choice — structured present', () => {
  it('renders FoxyStructuredRenderer when message.structured is schema-valid', () => {
    const msg: TestMsg = {
      role: 'tutor',
      content: 'fallback markdown text — should NOT appear',
      structured: {
        title: 'Newton\'s Second Law',
        subject: 'science',
        blocks: [
          { type: 'definition', label: 'Definition', text: 'Force = mass × acceleration.' },
          { type: 'answer', text: 'F = ma' },
        ],
      },
    };

    render(<ChatBubbleHarness msg={msg} />);

    // The structured renderer stamps a data-testid on its root.
    expect(screen.getByTestId('foxy-structured-renderer')).toBeInTheDocument();

    // Title from the structured payload renders.
    expect(screen.getByText("Newton's Second Law")).toBeInTheDocument();

    // English chrome string (from FoxyStructuredRenderer) confirms structured
    // path took control.
    expect(screen.getByText('Answer')).toBeInTheDocument();
    expect(screen.getByText('F = ma')).toBeInTheDocument();

    // The legacy markdown content must NOT have been rendered as a sibling.
    expect(
      screen.queryByText('fallback markdown text — should NOT appear'),
    ).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Tutor without structured → RichContent fallback
// ─────────────────────────────────────────────────────────────────────────────

describe('Foxy chat renderer choice — structured absent', () => {
  it('falls back to RichContent when message.structured is undefined', () => {
    const msg: TestMsg = {
      role: 'tutor',
      content: 'A plain markdown answer with **bold** text.',
      structured: undefined,
    };

    render(<ChatBubbleHarness msg={msg} />);

    // Structured renderer must not appear.
    expect(
      screen.queryByTestId('foxy-structured-renderer'),
    ).not.toBeInTheDocument();

    // The markdown text is rendered by RichContent. ReactMarkdown emits the
    // text inline; querying by partial match is robust to whitespace/wrapping.
    const node = screen.getByText(/A plain markdown answer/);
    expect(node).toBeInTheDocument();
  });

  it('falls back to RichContent when structured payload fails the shape guard', () => {
    // Caller passed an object that looks like FoxyResponse but is missing the
    // required `title` field. `isFoxyResponse` returns false → legacy path.
    const msg: TestMsg = {
      role: 'tutor',
      content: 'Legacy content shown because payload was malformed.',
      // Cast through unknown so we can simulate a runtime drift the type
      // system would otherwise reject.
      structured: { subject: 'math', blocks: [{ type: 'paragraph', text: 'x' }] } as unknown as FoxyResponse,
    };

    render(<ChatBubbleHarness msg={msg} />);

    expect(
      screen.queryByTestId('foxy-structured-renderer'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/Legacy content shown because payload was malformed/),
    ).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Error boundary — structured render throws → legacy markdown
// ─────────────────────────────────────────────────────────────────────────────

// We don't get a real exception out of FoxyStructuredRenderer (KaTeX's
// throwOnError=false means even bad LaTeX renders a soft fallback). To test
// the boundary independently we render a deliberate-throw component as the
// "structured" subtree and verify the fallback prop wins.

function Boom(): React.ReactElement {
  throw new Error('structured renderer exploded');
}

describe('StructuredRenderBoundary fallback', () => {
  it('renders the legacy RichContent fallback when the structured subtree throws', () => {
    const fallback = (
      <RichContent
        content="Always-visible fallback markdown."
        subjectKey="science"
      />
    );

    // Suppress React's expected error logging for this intentional throw.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <StructuredRenderBoundary fallback={fallback}>
        <Boom />
      </StructuredRenderBoundary>,
    );
    errorSpy.mockRestore();

    // The structured subtree throws — fallback's RichContent rendering wins.
    expect(
      screen.getByText(/Always-visible fallback markdown/),
    ).toBeInTheDocument();
  });
});
