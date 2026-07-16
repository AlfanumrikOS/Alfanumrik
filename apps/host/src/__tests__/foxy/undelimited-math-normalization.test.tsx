/**
 * Undelimited-math render-time normalization tests.
 *
 * ROOT CAUSE (2026-07 production screenshots): Foxy emits inline math WITHOUT
 * the required delimiters — e.g. `(\frac{14}{15} \times \frac{25}{42})` in a
 * paragraph `text` field instead of `\(\frac{14}{15} \times \frac{25}{42}\)`.
 * The tokenizer only enters math mode on `\(`, `\[`, `$`, `$$`, so these
 * spans rendered as raw LaTeX to students.
 *
 * The fix is a pure post-pass (`packages/ui/src/foxy/math-normalization.ts`)
 * over `tokenizeInline` output, wired into `InlineContent`. Binding CEO
 * constraints pinned here:
 *
 *   1. TRIGGER: fires ONLY on an explicit allowlisted backslash command with
 *      a word boundary (`\frac` yes, `\franchise` never). NEVER on bare `^`,
 *      `_`, or `$` (prose/code: `snake_case_name`, `x^2 …`, `price is $5`).
 *   2. SPAN: paren-wrapped pseudo-delimiters are stripped; bare runs capture
 *      the maximal contiguous math expression without swallowing prose.
 *   3. ACCEPTANCE (CEO constraint #6): the exact production screenshot
 *      strings render as stacked-fraction KaTeX with no prompt changes.
 *   4. BYTE-IDENTITY: properly-delimited math and command-free prose pass
 *      through the pipeline untouched (reference-equal segments).
 *   5. FAIL-SAFE: a malformed undelimited span degrades to the existing
 *      `<code>` fallback — never throws, never blanks (P12).
 *
 * Mocks mirror inline-content.test.tsx (AuthContext + useSubjectLookup).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import type { FoxyResponse } from '@alfanumrik/lib/foxy/schema';

vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => ({ isHi: false }),
}));

vi.mock('@alfanumrik/lib/useSubjectLookup', () => ({
  useSubjectLookup: () => () => ({
    code: 'math',
    icon: '∑',
    color: '#7C3AED',
    name: 'Math',
  }),
}));

// Import after mocks — the renderer pulls AuthContext at module-eval time.
import {
  FoxyStructuredRenderer,
  tokenizeInline,
  containsAllowlistedMathCommand,
  splitUndelimitedMath,
  normalizeMathSegments,
} from '@alfanumrik/ui/foxy/FoxyStructuredRenderer';

// ── Helpers ──────────────────────────────────────────────────────────────────

function resp(blocks: FoxyResponse['blocks']): FoxyResponse {
  return { title: 'Undelimited Math Test', subject: 'math', blocks };
}

function renderRoot(blocks: FoxyResponse['blocks']): HTMLElement {
  render(<FoxyStructuredRenderer response={resp(blocks)} subjectKey="math" />);
  return screen.getByTestId('foxy-structured-renderer');
}

/**
 * Visible (non-MathML-annotation) text. KaTeX keeps the original LaTeX source
 * in a hidden `.katex-mathml` <annotation>; strip it so assertions reflect
 * what the student actually sees.
 */
function visibleText(root: HTMLElement): string {
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.katex-mathml').forEach((n) => n.remove());
  return clone.textContent ?? '';
}

// The exact production screenshot strings (CEO constraint #6 — acceptance).
const SCREENSHOT_CASES: Array<{ text: string; proseKept: string[] }> = [
  {
    text: 'Example: (\\frac{14}{15} \\times \\frac{25}{42})',
    proseKept: ['Example:'],
  },
  {
    text: 'Cancel 14 and 42 by 14 → (\\frac{1}{15} \\times \\frac{25}{3})',
    proseKept: ['Cancel 14 and 42 by 14 →'],
  },
  {
    text: 'Cancel 25 and 15 by 5 → (\\frac{1}{3} \\times \\frac{5}{3} = \\frac{5}{9})',
    proseKept: ['Cancel 25 and 15 by 5 →'],
  },
  {
    text: '(6\\frac{1}{4} = \\frac{25}{4}), (2\\frac{1}{2} = \\frac{5}{2})',
    proseKept: [','],
  },
  {
    text: 'Then divide: (\\frac{25}{4} \\times \\frac{2}{5} = \\frac{5}{2})',
    proseKept: ['Then divide:'],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// 1. Trigger predicate (exported for the production canary corpus)
// ─────────────────────────────────────────────────────────────────────────────

describe('containsAllowlistedMathCommand — trigger predicate', () => {
  it('fires on every production screenshot string', () => {
    for (const { text } of SCREENSHOT_CASES) {
      expect(containsAllowlistedMathCommand(text)).toBe(true);
    }
  });

  it('fires on common CBSE commands', () => {
    expect(containsAllowlistedMathCommand('\\sqrt{2}')).toBe(true);
    expect(containsAllowlistedMathCommand('area \\pi r^2')).toBe(true);
    expect(containsAllowlistedMathCommand('\\angle ABC = 90\\degree')).toBe(true);
    expect(containsAllowlistedMathCommand('x \\le y')).toBe(true);
    expect(containsAllowlistedMathCommand('\\left( x \\right)')).toBe(true);
  });

  it('NEVER fires on bare ^, _, $ or brackets (CEO constraint)', () => {
    expect(containsAllowlistedMathCommand('snake_case_name')).toBe(false);
    expect(
      containsAllowlistedMathCommand('x^2 in plain prose without commands'),
    ).toBe(false);
    expect(containsAllowlistedMathCommand('price is $5 and $10')).toBe(false);
    expect(containsAllowlistedMathCommand('array[i]_index')).toBe(false);
    expect(containsAllowlistedMathCommand('a_b and c^d')).toBe(false);
    expect(containsAllowlistedMathCommand('plain text')).toBe(false);
    expect(containsAllowlistedMathCommand('')).toBe(false);
  });

  it('word boundary: \\franchise / \\fraction / \\lefty never match', () => {
    expect(containsAllowlistedMathCommand('\\franchise agreement')).toBe(false);
    expect(containsAllowlistedMathCommand('a \\fraction of cost')).toBe(false);
    expect(containsAllowlistedMathCommand('\\lefty pitcher')).toBe(false);
    // …but the real commands still fire when followed by non-letters.
    expect(containsAllowlistedMathCommand('\\frac{1}{2}')).toBe(true);
    expect(containsAllowlistedMathCommand('\\frac12')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Span detection algorithm (pure, no DOM)
// ─────────────────────────────────────────────────────────────────────────────

describe('splitUndelimitedMath — span detection', () => {
  it('shape (a): strips paren pseudo-delimiters, keeps prose byte-exact', () => {
    expect(
      splitUndelimitedMath('Example: (\\frac{14}{15} \\times \\frac{25}{42})'),
    ).toEqual([
      { kind: 'text', value: 'Example: ' },
      {
        kind: 'math',
        latex: '\\frac{14}{15} \\times \\frac{25}{42}',
        display: false,
      },
    ]);
  });

  it('shape (a): two paren groups → two math segments, ", " preserved', () => {
    expect(
      splitUndelimitedMath(
        '(6\\frac{1}{4} = \\frac{25}{4}), (2\\frac{1}{2} = \\frac{5}{2})',
      ),
    ).toEqual([
      { kind: 'math', latex: '6\\frac{1}{4} = \\frac{25}{4}', display: false },
      { kind: 'text', value: ', ' },
      { kind: 'math', latex: '2\\frac{1}{2} = \\frac{5}{2}', display: false },
    ]);
  });

  it('shape (b): bare run captures the maximal contiguous expression', () => {
    expect(
      splitUndelimitedMath(
        'Multiply \\frac{1}{2} \\times \\frac{3}{4} = \\frac{3}{8} today',
      ),
    ).toEqual([
      { kind: 'text', value: 'Multiply ' },
      {
        kind: 'math',
        latex: '\\frac{1}{2} \\times \\frac{3}{4} = \\frac{3}{8}',
        display: false,
      },
      { kind: 'text', value: ' today' },
    ]);
  });

  it('never swallows adjacent prose words', () => {
    expect(splitUndelimitedMath('so \\frac{1}{2} of the cake')).toEqual([
      { kind: 'text', value: 'so ' },
      { kind: 'math', latex: '\\frac{1}{2}', display: false },
      { kind: 'text', value: ' of the cake' },
    ]);
  });

  it('bare numbers near prose stay text; only the command run converts', () => {
    expect(
      splitUndelimitedMath('14 and 42 stay text but \\frac{1}{2} converts'),
    ).toEqual([
      { kind: 'text', value: '14 and 42 stay text but ' },
      { kind: 'math', latex: '\\frac{1}{2}', display: false },
      { kind: 'text', value: ' converts' },
    ]);
  });

  it('trailing sentence punctuation stays prose, outside the math span', () => {
    expect(splitUndelimitedMath('gives \\frac{3}{8}.')).toEqual([
      { kind: 'text', value: 'gives ' },
      { kind: 'math', latex: '\\frac{3}{8}', display: false },
      { kind: 'text', value: '.' },
    ]);
  });

  it('does not strip parens that are not a single wrapping pair', () => {
    expect(splitUndelimitedMath('(\\frac{1}{2})(\\frac{3}{4})')).toEqual([
      { kind: 'math', latex: '(\\frac{1}{2})(\\frac{3}{4})', display: false },
    ]);
  });

  it('returns command-free input as a single untouched text segment', () => {
    expect(splitUndelimitedMath('x^2 in plain prose without commands')).toEqual([
      { kind: 'text', value: 'x^2 in plain prose without commands' },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Pipeline byte-identity — already-correct input is untouched
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeMathSegments — byte-identity for already-correct input', () => {
  it.each([
    ['delimited \\(..\\)', 'in \\( \\frac{3}{4} \\), 3 is the numerator'],
    ['delimited $..$', '$\\frac{5}{3}$'],
    ['delimited $$..$$', 'display: $$x = \\frac{1}{2}$$ end'],
    ['delimited \\[..\\]', 'eqn \\[ x^2 \\] done'],
    ['prose with underscores', 'snake_case_name'],
    ['prose with caret', 'x^2 in plain prose without commands'],
    ['prose with dollars', 'price is $5 and $10'],
    ['prose with brackets', 'array[i]_index'],
    ['unknown command', '\\franchise agreement'],
  ])('%s → segments pass through reference-equal', (_label, input) => {
    const segments = tokenizeInline(input);
    // Reference equality: the post-pass returned the ORIGINAL array — the
    // strongest possible "nothing changed" guarantee.
    expect(normalizeMathSegments(segments)).toBe(segments);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. ACCEPTANCE — the production screenshot strings render as KaTeX fractions
// ─────────────────────────────────────────────────────────────────────────────

describe('acceptance — screenshot strings render as stacked-fraction KaTeX', () => {
  it.each(SCREENSHOT_CASES.map((c) => [c.text, c] as const))(
    '%s',
    (_text, { text, proseKept }) => {
      const root = renderRoot([{ type: 'paragraph', text }]);

      // KaTeX rendered — with a stacked fraction (.mfrac), not raw source.
      expect(root.querySelector('.katex')).not.toBeNull();
      expect(root.querySelector('.mfrac')).not.toBeNull();

      // No <code> fallback: the span is VALID KaTeX, not a degraded error.
      expect(root.querySelectorAll('code').length).toBe(0);

      // No raw LaTeX or fake delimiters leak into visible text.
      const visible = visibleText(root);
      expect(visible).not.toContain('\\frac');
      expect(visible).not.toContain('\\times');

      // Surrounding prose survives byte-exact.
      for (const prose of proseKept) {
        expect(visible).toContain(prose);
      }
    },
  );

  it('full pipeline segments for the mixed-number case (exact shape)', () => {
    const segs = normalizeMathSegments(
      tokenizeInline(
        '(6\\frac{1}{4} = \\frac{25}{4}), (2\\frac{1}{2} = \\frac{5}{2})',
      ),
    );
    expect(segs).toEqual([
      { kind: 'math', latex: '6\\frac{1}{4} = \\frac{25}{4}', display: false },
      { kind: 'text', value: ', ' },
      { kind: 'math', latex: '2\\frac{1}{2} = \\frac{5}{2}', display: false },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Applies to all text-bearing blocks (shared InlineContent path)
// ─────────────────────────────────────────────────────────────────────────────

describe('normalization applies across text-bearing block types', () => {
  it.each([
    ['example', { type: 'example', text: SCREENSHOT_CASES[0].text }],
    ['step', { type: 'step', text: SCREENSHOT_CASES[1].text }],
    ['answer', { type: 'answer', text: SCREENSHOT_CASES[4].text }],
    ['exam_tip', { type: 'exam_tip', text: 'Shortcut: (\\frac{1}{2} \\times \\frac{2}{3})' }],
    ['definition', { type: 'definition', text: 'A ratio like (\\frac{3}{4}) compares parts' }],
    ['question', { type: 'question', text: 'Simplify (\\frac{4}{8} \\times \\frac{2}{3})' }],
  ])('%s block renders undelimited math via KaTeX', (_label, block) => {
    const root = renderRoot([block as FoxyResponse['blocks'][number]]);
    expect(root.querySelector('.katex')).not.toBeNull();
    expect(root.querySelector('.mfrac')).not.toBeNull();
    expect(visibleText(root)).not.toContain('\\frac');
  });

  it('mcq stem + options render undelimited math via KaTeX', () => {
    const root = renderRoot([
      {
        type: 'mcq',
        stem: 'What is (\\frac{1}{2} \\times \\frac{2}{3}) equal to?',
        options: [
          '(\\frac{1}{3})',
          '(\\frac{2}{5})',
          '(\\frac{3}{4})',
          '(\\frac{1}{6})',
        ],
        correct_answer_index: 0,
        explanation: 'Multiply across: numerators 1×2, denominators 2×3, then simplify.',
      } as FoxyResponse['blocks'][number],
    ]);
    // Stem + 4 options each carry one fraction expression.
    expect(root.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(5);
    expect(visibleText(root)).not.toContain('\\frac');
    // Prose around the stem math is preserved.
    expect(visibleText(root)).toContain('What is');
    expect(visibleText(root)).toContain('equal to?');
  });

  it('code blocks do NOT route through normalization — raw LaTeX preserved', () => {
    const root = renderRoot([
      {
        type: 'code',
        text: 'const half = "\\frac{1}{2}"; // raw string',
        language: 'javascript',
      } as FoxyResponse['blocks'][number],
    ]);
    expect(root.querySelector('.katex')).toBeNull();
    const pre = root.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre!.textContent).toContain('\\frac{1}{2}');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Negatives in the DOM + fail-safe degradation (P12)
// ─────────────────────────────────────────────────────────────────────────────

describe('negatives and fail-safety', () => {
  it('x^2 prose without commands renders verbatim — no KaTeX, no code', () => {
    const root = renderRoot([
      { type: 'paragraph', text: 'x^2 in plain prose without commands' },
    ]);
    expect(root.querySelector('.katex')).toBeNull();
    expect(root.querySelector('p code')).toBeNull();
    expect(root.textContent).toContain('x^2 in plain prose without commands');
  });

  it('array[i]_index renders verbatim', () => {
    const root = renderRoot([{ type: 'paragraph', text: 'array[i]_index' }]);
    expect(root.querySelector('.katex')).toBeNull();
    expect(root.textContent).toContain('array[i]_index');
  });

  it('snake_case_name produces no math and no code fallback', () => {
    // NOTE: the pre-existing inline-markdown parser may treat `_case_` as
    // italics — that behavior is unchanged by this fix and pinned elsewhere.
    // Here we only assert the math pipeline stays out of it.
    const root = renderRoot([{ type: 'paragraph', text: 'snake_case_name' }]);
    expect(root.querySelector('.katex')).toBeNull();
    expect(root.querySelector('p code')).toBeNull();
  });

  it('malformed undelimited span degrades to <code>, never throws (P12)', () => {
    expect(() => {
      renderRoot([{ type: 'paragraph', text: 'try \\frac{1}{ now' }]);
    }).not.toThrow();

    const root = screen.getByTestId('foxy-structured-renderer');
    const codes = Array.from(root.querySelectorAll('code'));
    expect(codes.length).toBeGreaterThanOrEqual(1);
    expect(codes.map((c) => c.textContent ?? '').join(' ')).toContain(
      '\\frac{1}{',
    );
    // Prose on both sides survives.
    expect(root.textContent).toContain('try');
    expect(root.textContent).toContain('now');
  });
});
