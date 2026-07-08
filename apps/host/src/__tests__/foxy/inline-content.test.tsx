/**
 * Foxy inline-content rendering tests.
 *
 * Pins the inline math + markdown-emphasis pipeline that lives inside
 * `FoxyStructuredRenderer` (the `tokenizeInline` tokenizer + the `InlineContent`
 * component that feeds KaTeX and the safe inline-markdown parser). The shipped
 * behavior under test:
 *
 *   1. `**bold**` inside a prose block renders <strong>, and NO raw `**`
 *      survives into the DOM.
 *   2. Inline `\( ... \)` / `\[ ... \]` / `$ ... $` / `$$ ... $$` math renders
 *      via KaTeX (a `.katex` element appears) with NO raw delimiter or `\frac`
 *      source text leaking into a text node.
 *   3. Malformed inline math (`\( \frac{1}{ \)`) degrades to a `<code>` fallback
 *      and never throws (P12 AI Safety — a bad formula must not crash the chat
 *      list).
 *
 * Rendered via @testing-library/react, mirroring structured-rendering.test.tsx
 * (AuthContext + useSubjectLookup are mocked so the test is independent of the
 * auth provider and subjects service). We exercise `InlineContent` through the
 * public `FoxyStructuredRenderer` (it is not exported on its own) and assert the
 * tokenizer contract directly via the exported `tokenizeInline`.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import type { FoxyResponse } from '@alfanumrik/lib/foxy/schema';

// ── Auth + subject lookup mocks (mirror structured-rendering.test.tsx) ─────────

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
} from '@alfanumrik/ui/foxy/FoxyStructuredRenderer';

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Wrap one or more prose blocks in a minimal schema-valid FoxyResponse. */
function resp(blocks: FoxyResponse['blocks']): FoxyResponse {
  return { title: 'Inline Test', subject: 'math', blocks };
}

/** The rendered structured-renderer root (where InlineContent output lives). */
function renderRoot(blocks: FoxyResponse['blocks']): HTMLElement {
  render(<FoxyStructuredRenderer response={resp(blocks)} subjectKey="math" />);
  return screen.getByTestId('foxy-structured-renderer');
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Markdown emphasis → <strong>, no raw `**`
// ─────────────────────────────────────────────────────────────────────────────

describe('InlineContent — markdown emphasis', () => {
  it('renders **bold** as <strong> with no raw ** in the DOM', () => {
    const root = renderRoot([
      { type: 'paragraph', text: 'A **fraction** has a **numerator**' },
    ]);

    // Two bold words → two <strong> elements with the inner text.
    const strongs = root.querySelectorAll('strong');
    const strongText = Array.from(strongs).map((s) => s.textContent);
    expect(strongText).toContain('fraction');
    expect(strongText).toContain('numerator');

    // No raw asterisks survive anywhere in the rendered subtree.
    expect(root.textContent).not.toContain('**');
    expect(root.textContent).not.toContain('*');

    // The surrounding plain text is preserved.
    expect(root.textContent).toContain('A ');
    expect(root.textContent).toContain(' has a ');
  });

  it('renders *italic* as <em> and leaves no raw single asterisk', () => {
    const root = renderRoot([
      { type: 'paragraph', text: 'this is *emphasised* prose' },
    ]);
    const ems = root.querySelectorAll('em');
    expect(Array.from(ems).map((e) => e.textContent)).toContain('emphasised');
    expect(root.textContent).not.toContain('*');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Inline math renders via KaTeX — no raw delimiters / source leak
// ─────────────────────────────────────────────────────────────────────────────

describe('InlineContent — inline math via KaTeX', () => {
  it('renders \\( \\frac{3}{4} \\) inline with KaTeX and no raw \\( or \\frac leak', () => {
    const root = renderRoot([
      {
        type: 'definition',
        text: 'in \\( \\frac{3}{4} \\), 3 is the numerator',
      },
    ]);

    // KaTeX emits at least one element with class "katex".
    expect(root.querySelector('.katex')).not.toBeNull();

    // No raw delimiter or LaTeX source survives as visible text. KaTeX puts the
    // source only inside an <annotation> (MathML semantics), never a bare text
    // node, so the rendered surface must not show `\(` or `\frac`.
    const visible = visibleText(root);
    expect(visible).not.toContain('\\(');
    expect(visible).not.toContain('\\)');
    expect(visible).not.toContain('\\frac');

    // Surrounding prose is still present.
    expect(visible).toContain('3 is the numerator');
  });

  it('renders a $...$ span and a \\( ... \\) span both as KaTeX', () => {
    const root = renderRoot([
      { type: 'paragraph', text: '$\\frac{5}{3}$' },
      { type: 'paragraph', text: '1 \\( \\frac{1}{2} \\)' },
    ]);

    // Both prose blocks produced KaTeX output → at least two .katex roots.
    expect(root.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(2);

    const visible = visibleText(root);
    expect(visible).not.toContain('$');
    expect(visible).not.toContain('\\(');
    expect(visible).not.toContain('\\frac');
    // The literal "1 " from the mixed number prose is preserved.
    expect(visible).toContain('1');
  });

  it('renders $$...$$ display math as KaTeX', () => {
    const root = renderRoot([
      { type: 'paragraph', text: 'display: $$x = \\frac{1}{2}$$ end' },
    ]);
    expect(root.querySelector('.katex')).not.toBeNull();
    const visible = visibleText(root);
    expect(visible).not.toContain('$');
    expect(visible).not.toContain('\\frac');
    expect(visible).toContain('display:');
    expect(visible).toContain('end');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Malformed inline math → graceful <code> fallback, no throw
// ─────────────────────────────────────────────────────────────────────────────

describe('InlineContent — malformed math degrades gracefully', () => {
  it('falls back to <code> for malformed \\( \\frac{1}{ \\) and never throws', () => {
    // The render call itself must not throw (P12 — a bad formula cannot crash
    // the chat list).
    expect(() => {
      renderRoot([{ type: 'paragraph', text: 'bad \\( \\frac{1}{ \\) here' }]);
    }).not.toThrow();

    const root = screen.getByTestId('foxy-structured-renderer');

    // Degradation path: the raw inner expression is shown inside a <code> tag,
    // NOT as a successfully-rendered .katex tree.
    const codes = root.querySelectorAll('code');
    expect(codes.length).toBeGreaterThanOrEqual(1);
    const codeText = Array.from(codes)
      .map((c) => c.textContent ?? '')
      .join(' ');
    expect(codeText).toContain('\\frac{1}{');

    // The delimiters themselves are stripped (only the inner expression is
    // surfaced), and the surrounding prose still renders.
    expect(root.textContent).toContain('bad');
    expect(root.textContent).toContain('here');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. tokenizeInline — tokenizer contract (pure, no DOM)
// ─────────────────────────────────────────────────────────────────────────────

describe('tokenizeInline — segment contract', () => {
  it('splits plain + inline math into ordered text/math segments', () => {
    const segs = tokenizeInline('in \\( \\frac{3}{4} \\), 3 is the numerator');
    expect(segs).toEqual([
      { kind: 'text', value: 'in ' },
      { kind: 'math', latex: '\\frac{3}{4}', display: false },
      { kind: 'text', value: ', 3 is the numerator' },
    ]);
  });

  it('recognises $...$ as inline and $$...$$ as display math', () => {
    expect(tokenizeInline('$\\frac{5}{3}$')).toEqual([
      { kind: 'math', latex: '\\frac{5}{3}', display: false },
    ]);
    expect(tokenizeInline('see $$y=mx$$ ok')).toEqual([
      { kind: 'text', value: 'see ' },
      { kind: 'math', latex: 'y=mx', display: true },
      { kind: 'text', value: ' ok' },
    ]);
  });

  it('recognises \\[ ... \\] as display math', () => {
    expect(tokenizeInline('eqn \\[ x^2 \\] done')).toEqual([
      { kind: 'text', value: 'eqn ' },
      { kind: 'math', latex: 'x^2', display: true },
      { kind: 'text', value: ' done' },
    ]);
  });

  it('treats an unterminated delimiter as literal text (no swallow, no throw)', () => {
    // No closing `\)` — the whole string stays plain text.
    const segs = tokenizeInline('open \\( \\frac{1}{ then nothing');
    expect(segs).toEqual([
      { kind: 'text', value: 'open \\( \\frac{1}{ then nothing' },
    ]);
  });

  it('treats escaped \\$ as a literal dollar, not a delimiter', () => {
    expect(tokenizeInline('pay \\$5 today')).toEqual([
      { kind: 'text', value: 'pay $5 today' },
    ]);
  });
});

// ── Local helper: visible (non-MathML-annotation) text ────────────────────────
//
// KaTeX renders both an HTML tree (what the user sees) and a hidden MathML
// <annotation encoding="application/x-tex"> node that holds the original LaTeX
// source for accessibility/copy. `element.textContent` includes that annotation,
// so a naive textContent check would wrongly "see" the raw `\frac`. We strip
// every `.katex-mathml` subtree (which contains the annotation) before reading
// text, so assertions reflect what is actually visible on screen.

function visibleText(root: HTMLElement): string {
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.katex-mathml').forEach((n) => n.remove());
  return clone.textContent ?? '';
}
