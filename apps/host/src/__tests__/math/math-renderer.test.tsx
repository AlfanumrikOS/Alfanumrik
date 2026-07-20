/**
 * MathRenderer — canonical spec render cases through the NEW question-bank
 * surfaces (docs/math-rendering-spec.md §2/§3, 2026-07-20 consolidation).
 *
 * Scope (testing-gate items A1/A2 — REAL pipeline, no mocks of the math
 * modules; the Foxy structured layer is already pinned by
 * math-canary-corpus.test.ts / REG-257 and is deliberately NOT duplicated):
 *
 *   1. The canonical spec strings render as KaTeX (`.katex` present) with no
 *      raw delimiter text leaking to the student:
 *        - `\( \frac{3}{4} \)`   (inline fraction)
 *        - `\( x^{2} \)`         (inline superscript)
 *        - `\[ \sum_{k=1}^{n} k \]` (display math → `.katex-display` + the
 *          overflow-x scroll containment wrapper)
 *        - a multi-step justified chain (band 11-12 raw-markdown explanation:
 *          prose action lines + display math + `\because` + `\boxed{}`)
 *      each exercised through the EXACT invocation shapes the new surfaces
 *      use: `<MathRenderer content={explanation} />` (QuizResults model
 *      answer / explanation, quiz-page explanation) and
 *      `<MathRenderer inline content={opt} />` (option rows), plus a REAL
 *      `<MockTestRunner />` mount for mock-exam question text and options.
 *   2. `inline` forces inline math — display-math input on an option row
 *      never produces `.katex-display` or the scroll wrapper.
 *   3. Display math (block mode) gets the `overflow-x-auto` scroll wrapper
 *      (360px narrow-viewport containment).
 *   4. `markdown` is OFF by default — a literal `2*3*4` in question text is
 *      never mangled into <em>.
 *   5. `containsRenderableMath` fast-path predicate contract.
 *
 * The fail-safe half (error boundary → raw text, Suspense fallback, lazy
 * no-import fast path) lives in math-renderer-failsafe.test.tsx (it mocks
 * the katex-segments chunk, so it must be a separate module registry).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import React from 'react';

// MockTestRunner pulls next/navigation at module scope.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

import MathRenderer from '@alfanumrik/ui/math/MathRenderer';
import { containsRenderableMath } from '@alfanumrik/ui/math/normalize';
import MockTestRunner from '@alfanumrik/ui/exams/MockTestRunner';
import type { MockTestPaper, MockTestQuestion } from '@alfanumrik/ui/exams/mock-test-types';

// ── Deflake (2026-07-20): warm the lazy KaTeX chunk at module scope ──────────
// MathRenderer loads katex-segments via React.lazy. The FIRST test to await
// `.katex` paid the COLD transform + evaluation of the entire katex package
// inside a 1000ms default `waitFor` deadline — under multi-file worker
// contention (transform ~4s / import ~17s aggregate in the failing runs) the
// import exceeded 1s and the assertion saw the raw-text Suspense fallback
// (the component working as designed) and timed out. Importing the chunk here
// pre-populates Vitest's module cache during file collection (no per-hook
// deadline), so React.lazy's dynamic import resolves in a microtask.
// This is a test-lane warm-up only — it changes nothing about the P10 lazy
// posture under test (the lazy path itself is pinned by the fast-path tests
// in math-renderer-failsafe.test.tsx).
import '@alfanumrik/ui/math/katex-segments';

// Belt-and-braces companion to the warm-up above: even with a warm module
// cache, the scheduler retry after lazy resolution can stall multiple seconds
// when sibling jsdom workers hog the CPU. Vitest's testTimeout is 120s, so a
// generous waitFor ceiling costs nothing on green runs (resolution is ~ms).
const KATEX_WAIT = { timeout: 15_000 };

afterEach(() => cleanup());

/**
 * Visible (non-MathML-annotation) text. KaTeX keeps the original LaTeX source
 * in a hidden `.katex-mathml` <annotation>; strip it so "no raw delimiter
 * leak" assertions reflect what the student actually sees. (Same helper
 * convention as undelimited-math-normalization.test.tsx.)
 */
function visibleText(root: HTMLElement): string {
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.katex-mathml').forEach((n) => n.remove());
  return clone.textContent ?? '';
}

function expectNoRawDelimiterLeak(root: HTMLElement) {
  const seen = visibleText(root);
  expect(seen).not.toContain('\\(');
  expect(seen).not.toContain('\\)');
  expect(seen).not.toContain('\\[');
  expect(seen).not.toContain('\\]');
  expect(seen).not.toContain('\\frac');
  expect(seen).not.toContain('\\sum');
  expect(seen).not.toContain('\\boxed');
}

async function renderAndAwaitKatex(ui: React.ReactElement): Promise<HTMLElement> {
  const { container } = render(ui);
  await waitFor(() => {
    expect(container.querySelector('.katex')).toBeTruthy();
  }, KATEX_WAIT);
  return container;
}

// ── Canonical spec strings (docs/math-rendering-spec.md §2/§3.3) ─────────────

const INLINE_FRACTION = 'The answer is \\( \\frac{3}{4} \\) of the total.';
const INLINE_SQUARE = 'So \\( x^{2} \\) grows faster than \\( x \\).';
const DISPLAY_SUM = 'Recall the identity: \\[ \\sum_{k=1}^{n} k \\] for natural numbers.';

// Band 11-12 justified chain as a raw-markdown quiz explanation (§3.3 + §4:
// raw-markdown surface → `\boxed{}` around the final value).
const JUSTIFIED_CHAIN = [
  'Differentiate \\( y = x^{2} \\sin x \\) with respect to \\( x \\).',
  'Apply the product rule (NCERT Class 12).',
  '\\[ \\frac{dy}{dx} = x^{2} \\, \\frac{d}{dx}(\\sin x) + \\sin x \\, \\frac{d}{dx}(x^{2}) \\]',
  'Differentiate each factor \\( \\left[ \\because \\tfrac{d}{dx}\\sin x = \\cos x \\right] \\).',
  '\\[ \\boxed{\\frac{dy}{dx} = x^{2} \\cos x + 2x \\sin x} \\]',
].join('\n');

// ── 1. Spec render cases through the quiz-explanation invocation shape ───────

describe('MathRenderer — canonical spec strings as QuizResults/quiz-page render explanations', () => {
  it('inline fraction \\( \\frac{3}{4} \\): KaTeX output present, stacked fraction, no raw delimiter leak', async () => {
    // Exact invocation shape from QuizResults.tsx: <MathRenderer content={explanation} />
    const container = await renderAndAwaitKatex(<MathRenderer content={INLINE_FRACTION} />);
    expect(container.querySelector('.katex')).toBeTruthy();
    // A true stacked fraction, not prose "3/4".
    expect(container.querySelector('.mfrac')).toBeTruthy();
    // Inline math: no display block for an inline-delimited expression.
    expect(container.querySelector('.katex-display')).toBeNull();
    expectNoRawDelimiterLeak(container);
    // Surrounding prose is preserved.
    expect(visibleText(container)).toContain('The answer is');
    expect(visibleText(container)).toContain('of the total.');
  });

  it('inline superscript \\( x^{2} \\): KaTeX output present, no raw "^{" leak', async () => {
    const container = await renderAndAwaitKatex(<MathRenderer content={INLINE_SQUARE} />);
    expect(container.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(2);
    expectNoRawDelimiterLeak(container);
    expect(visibleText(container)).not.toContain('^{');
    expect(visibleText(container)).toContain('grows faster than');
  });

  it('display \\[ \\sum ... \\]: .katex-display present AND wrapped in the overflow-x scroll container', async () => {
    const container = await renderAndAwaitKatex(<MathRenderer content={DISPLAY_SUM} />);
    expect(container.querySelector('.katex-display')).toBeTruthy();
    // Narrow-viewport containment: long display equations scroll, never clip.
    const scrollWrap = container.querySelector('.overflow-x-auto');
    expect(scrollWrap).toBeTruthy();
    expect(scrollWrap!.className).toContain('block');
    expect(scrollWrap!.className).toContain('max-w-full');
    expect(scrollWrap!.querySelector('.katex-display')).toBeTruthy();
    expectNoRawDelimiterLeak(container);
  });

  it('multi-step justified chain (band 11-12 explanation): all pairs render, \\because/\\boxed never leak', async () => {
    const container = await renderAndAwaitKatex(<MathRenderer content={JUSTIFIED_CHAIN} />);
    // Two display blocks (product-rule expansion + boxed final answer), each scroll-contained.
    const displays = container.querySelectorAll('.katex-display');
    expect(displays.length).toBe(2);
    expect(container.querySelectorAll('.overflow-x-auto').length).toBe(2);
    // Inline pairs too (given line + justification line).
    expect(container.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(4);
    expectNoRawDelimiterLeak(container);
    const seen = visibleText(container);
    expect(seen).not.toContain('\\because');
    expect(seen).not.toContain('\\tfrac');
    // The plain-language justified action lines stay as prose.
    expect(seen).toContain('Apply the product rule (NCERT Class 12).');
    expect(seen).toContain('Differentiate each factor');
  });
});

// ── 2/3. Option rows: `inline` forces inline math ────────────────────────────

describe('MathRenderer — `inline` prop (option-row contract)', () => {
  it('display-math input with inline: renders KaTeX but NEVER .katex-display or the scroll wrapper', async () => {
    // Exact invocation shape from QuizResults.tsx / quiz page / MockTestRunner
    // option rows: <MathRenderer inline content={opt} />
    const container = await renderAndAwaitKatex(
      <MathRenderer inline content={'\\[ \\frac{3}{4} \\]'} />,
    );
    expect(container.querySelector('.katex')).toBeTruthy();
    expect(container.querySelector('.mfrac')).toBeTruthy();
    expect(container.querySelector('.katex-display')).toBeNull();
    expect(container.querySelector('.overflow-x-auto')).toBeNull();
    expectNoRawDelimiterLeak(container);
  });

  it('inline-delimited option content renders inline (no display escalation)', async () => {
    const container = await renderAndAwaitKatex(
      <MathRenderer inline content={'\\( x^{2} \\)'} />,
    );
    expect(container.querySelector('.katex')).toBeTruthy();
    expect(container.querySelector('.katex-display')).toBeNull();
    expectNoRawDelimiterLeak(container);
  });
});

// ── 4. markdown OFF by default ───────────────────────────────────────────────

describe('MathRenderer — markdown emphasis is OFF by default (question-bank posture)', () => {
  it('a literal 2*3*4 in question text is never mangled into <em>', async () => {
    const container = await renderAndAwaitKatex(
      <MathRenderer content={'Multiply 2*3*4 and compare with \\( \\frac{1}{2} \\).'} />,
    );
    expect(visibleText(container)).toContain('2*3*4');
    expect(container.querySelector('em')).toBeNull();
    expect(container.querySelector('strong')).toBeNull();
  });
});

// ── 5. containsRenderableMath fast-path predicate ────────────────────────────

describe('containsRenderableMath — the lazy-load gate (fast-path predicate)', () => {
  it('plain question text → false (no KaTeX cost)', () => {
    expect(containsRenderableMath('Which gas is most abundant in air?')).toBe(false);
    expect(containsRenderableMath('')).toBe(false);
  });

  it('delimiters and allowlisted commands → true', () => {
    expect(containsRenderableMath('\\( x \\)')).toBe(true);
    expect(containsRenderableMath('\\[ x \\]')).toBe(true);
    expect(containsRenderableMath('price is $5 or $6')).toBe(true); // errs permissive on $
    expect(containsRenderableMath('undelimited \\frac{1}{2} slip')).toBe(true);
  });

  it('non-allowlisted backslash words never trigger (word boundary)', () => {
    expect(containsRenderableMath('the \\franchise agreement')).toBe(false);
  });

  it('plain content renders synchronously as exact text with zero KaTeX DOM', () => {
    // No await: the fast path must not suspend.
    const { container } = render(<MathRenderer content="Which gas is most abundant in air?" />);
    expect(container.textContent).toBe('Which gas is most abundant in air?');
    expect(container.querySelector('.katex')).toBeNull();
  });
});

// ── MockTestRunner: real mount, mock-exam question text + options ────────────

describe('MockTestRunner — mock-exam surface renders spec math through MathRenderer', () => {
  const paper: MockTestPaper = {
    id: 'paper-1',
    paper_code: 'JEE-MAIN-2025-M1',
    exam_family: 'jee',
    exam_year: 2025,
    total_questions: 1,
    duration_minutes: 10,
    subject_scope: ['math'],
  };

  const questions: MockTestQuestion[] = [
    {
      id: 'q-1',
      question_number: 1,
      question_text: 'Evaluate \\[ \\sum_{k=1}^{n} k \\] for \\( n = 4 \\).',
      question_type: 'mcq_single',
      // Display-delimited option deliberately included: the option row's
      // `inline` prop must force it inline.
      options: ['\\( \\frac{3}{4} \\)', '\\[ x^{2} \\]', '\\( 10 \\)', '\\( 12 \\)'],
      marks_correct: 4,
      marks_wrong: -1,
    },
  ];

  it('question text: display sum renders as .katex-display inside the scroll wrapper; no raw delimiter leak', async () => {
    const { container } = render(
      <MockTestRunner paper={paper} questions={questions} isHi={false} />,
    );
    await waitFor(() => {
      expect(container.querySelector('.katex')).toBeTruthy();
    }, KATEX_WAIT);
    expect(container.querySelector('.katex-display')).toBeTruthy();
    expect(container.querySelector('.overflow-x-auto')).toBeTruthy();
    expectNoRawDelimiterLeak(container);
    expect(visibleText(container)).toContain('Evaluate');
  });

  it('option rows: math renders as KaTeX, and NO option ever produces display math', async () => {
    const { container } = render(
      <MockTestRunner paper={paper} questions={questions} isHi={false} />,
    );
    await waitFor(() => {
      expect(container.querySelector('.katex')).toBeTruthy();
    }, KATEX_WAIT);
    const group = container.querySelector('[role="radiogroup"], [role="group"]');
    expect(group).toBeTruthy();
    // All four options carry KaTeX output.
    expect(group!.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(4);
    // The display-delimited option was forced inline: no display block and no
    // scroll wrapper anywhere inside the option group.
    expect(group!.querySelector('.katex-display')).toBeNull();
    expect(group!.querySelector('.overflow-x-auto')).toBeNull();
    const seen = visibleText(group as HTMLElement);
    expect(seen).not.toContain('\\(');
    expect(seen).not.toContain('\\[');
    expect(seen).not.toContain('\\frac');
  });
});
