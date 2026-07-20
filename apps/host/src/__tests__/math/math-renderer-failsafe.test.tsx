/**
 * MathRenderer fail-safe posture (docs/math-rendering-spec.md §5, P6/P12).
 *
 * This file mocks the `katex-segments` chunk (the lazy KaTeX half of the
 * canonical pipeline) to simulate chunk/render failure and slow loading —
 * which is why it is a SEPARATE file from math-renderer.test.tsx (that file
 * needs the REAL KaTeX output; vitest module registries are per-file).
 *
 * Pins:
 *   1. ERROR BOUNDARY → RAW TEXT: if the lazy chunk fails to load or throws
 *      during render (flaky 4G, KaTeX internal error), the student sees the
 *      RAW question text — never a blank question (P6) and never a crash in
 *      the quiz flow (P12-adjacent).
 *   2. SUSPENSE FALLBACK → RAW TEXT: while the chunk is loading, the raw
 *      text is shown (visible > pretty).
 *   3. FAST PATH → NO LAZY IMPORT: plain question text (no delimiters, no
 *      allowlisted command) renders synchronously WITHOUT ever invoking the
 *      katex-segments component (P10: zero KaTeX cost for plain questions).
 *   4. Prop passthrough: `inline`/`markdown` reach the segments renderer
 *      (the option-row inline contract depends on it).
 *   5. Nullish content renders nothing; `className` wraps both paths.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import React from 'react';

// Shared mutable control for the hoisted mock factory.
const ctl = vi.hoisted(() => ({
  mode: 'render' as 'render' | 'throw' | 'suspend',
  calls: 0,
  lastProps: null as null | { content: string; inline?: boolean; markdown?: boolean },
}));

// Intercepts BOTH the alias specifier and MathRenderer's relative
// `import('./katex-segments')` (vitest mocks by resolved module id).
vi.mock('@alfanumrik/ui/math/katex-segments', async () => {
  const ReactMod = await import('react');
  function MockMathSegments(props: { content: string; inline?: boolean; markdown?: boolean }) {
    ctl.calls += 1;
    ctl.lastProps = { ...props };
    if (ctl.mode === 'suspend') {
      // Suspend forever: simulates the chunk still streaming on slow 4G.
      throw new Promise(() => undefined);
    }
    if (ctl.mode === 'throw') {
      throw new Error('simulated katex-segments chunk/render failure');
    }
    return ReactMod.default.createElement(
      'span',
      { 'data-testid': 'mock-katex-segments' },
      '[katex]',
    );
  }
  return { default: MockMathSegments };
});

import MathRenderer from '@alfanumrik/ui/math/MathRenderer';

const MATH_CONTENT = 'Simplify \\( \\frac{3}{4} + \\frac{1}{4} \\) fully.';
const PLAIN_CONTENT = 'Which gas is most abundant in air?';

// Deflake (2026-07-20): the lazy chunk here resolves to the cheap mock, but
// RTL's default 1000ms waitFor deadline can still expire when sibling jsdom
// workers stall the event loop during a multi-file run (the same contention
// class that flaked math-renderer.test.tsx's cold KaTeX import). testTimeout
// is 120s, so a generous ceiling costs nothing on green runs (~ms).
const LAZY_WAIT = { timeout: 15_000 };

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  ctl.mode = 'render';
  ctl.calls = 0;
  ctl.lastProps = null;
  // React logs boundary-caught errors to console.error; keep test output clean.
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  consoleErrorSpy.mockRestore();
});

describe('MathRenderer — error boundary → raw-text fallback (P6: never blank)', () => {
  it('a throwing katex-segments render degrades to the RAW question text, never a blank or a crash', async () => {
    ctl.mode = 'throw';
    const { container } = render(<MathRenderer content={MATH_CONTENT} />);
    await waitFor(() => {
      // The chunk was attempted (math content) and failed…
      expect(ctl.calls).toBeGreaterThanOrEqual(1);
      // …so the boundary shows the raw text — byte-for-byte, never empty.
      expect(container.textContent).toBe(MATH_CONTENT);
    }, LAZY_WAIT);
    expect(container.textContent!.trim().length).toBeGreaterThan(0);
    expect(container.querySelector('[data-testid="mock-katex-segments"]')).toBeNull();
  });

  it('the raw-text fallback keeps the className wrapper', async () => {
    ctl.mode = 'throw';
    const { container } = render(
      <MathRenderer content={MATH_CONTENT} className="quiz-question-text" />,
    );
    await waitFor(() => {
      expect(container.textContent).toBe(MATH_CONTENT);
    }, LAZY_WAIT);
    expect(container.querySelector('span.quiz-question-text')).toBeTruthy();
  });
});

describe('MathRenderer — Suspense fallback shows raw text while the chunk loads', () => {
  it('raw text is visible immediately on first render and stays visible while suspended', async () => {
    ctl.mode = 'suspend';
    const { container } = render(<MathRenderer content={MATH_CONTENT} />);
    // Immediately (lazy import not yet resolved): raw text, not blank.
    expect(container.textContent).toBe(MATH_CONTENT);
    // After the mocked module resolves, the component suspends forever —
    // the fallback must STILL be the raw text.
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe(MATH_CONTENT);
    expect(container.querySelector('[data-testid="mock-katex-segments"]')).toBeNull();
  });
});

describe('MathRenderer — fast path: plain text never invokes the lazy chunk (P10)', () => {
  it('plain question text renders synchronously with ZERO katex-segments invocations', async () => {
    const { container } = render(<MathRenderer content={PLAIN_CONTENT} />);
    // Synchronous: exact text, no Suspense involvement.
    expect(container.textContent).toBe(PLAIN_CONTENT);
    // Give any stray lazy resolution a beat, then confirm the chunk component
    // was never rendered.
    await new Promise((r) => setTimeout(r, 20));
    expect(ctl.calls).toBe(0);
  });

  it('fast path honors className', () => {
    const { container } = render(
      <MathRenderer content={PLAIN_CONTENT} className="plain-cell" />,
    );
    expect(container.querySelector('span.plain-cell')?.textContent).toBe(PLAIN_CONTENT);
    expect(ctl.calls).toBe(0);
  });
});

describe('MathRenderer — prop passthrough to the segments renderer', () => {
  it('defaults: inline=false, markdown=false (question-bank posture)', async () => {
    const { container } = render(<MathRenderer content={MATH_CONTENT} />);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="mock-katex-segments"]')).toBeTruthy();
    }, LAZY_WAIT);
    expect(ctl.lastProps).toMatchObject({
      content: MATH_CONTENT,
      inline: false,
      markdown: false,
    });
  });

  it('`inline` reaches the segments renderer (option-row contract)', async () => {
    const { container } = render(<MathRenderer inline content={MATH_CONTENT} />);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="mock-katex-segments"]')).toBeTruthy();
    }, LAZY_WAIT);
    expect(ctl.lastProps).toMatchObject({ content: MATH_CONTENT, inline: true });
  });
});

describe('MathRenderer — nullish content', () => {
  it('null / undefined / empty string render nothing and never touch the chunk', () => {
    const a = render(<MathRenderer content={null} />);
    expect(a.container.firstChild).toBeNull();
    const b = render(<MathRenderer content={undefined} />);
    expect(b.container.firstChild).toBeNull();
    const c = render(<MathRenderer content="" />);
    expect(c.container.firstChild).toBeNull();
    expect(ctl.calls).toBe(0);
  });
});
