/**
 * FoxyStructuredRenderer — block rendering, step numbering, KaTeX fallback,
 * bilingual chrome, and isFoxyResponse type guard.
 *
 * These tests pin the new structured-block renderer that replaces markdown
 * for any Foxy message validated against FoxyResponseSchema. They lock down:
 *   1. All 8 block types render their core content.
 *   2. Step numbering auto-increments across consecutive step blocks and
 *      resets when a non-step block intervenes.
 *   3. Malformed LaTeX renders the soft-fail fallback (no thrown error).
 *   4. `isHi=true` swaps chrome strings to Hindi (P7 invariant).
 *   5. `isFoxyResponse` accepts a valid response and rejects strings/garbage.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import type { FoxyResponse } from '@/lib/foxy/schema';

// ── Mocks ────────────────────────────────────────────────────────────────────

// Mutable bilingual flag so individual tests can flip Hindi mode.
const mockIsHi = { value: false };
vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ isHi: mockIsHi.value }),
}));

// useSubjectLookup returns a function (subjectCode) => Subject | null. We
// return a fixed shape so cfg color/icon are stable in assertions.
vi.mock('@/lib/useSubjectLookup', () => ({
  useSubjectLookup: () => () => ({
    code: 'math',
    icon: '📐',
    color: '#10B981',
    name: 'Math',
  }),
}));

import {
  FoxyStructuredRenderer,
  isFoxyResponse,
} from '@/components/foxy/FoxyStructuredRenderer';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeResponse(blocks: FoxyResponse['blocks']): FoxyResponse {
  return {
    title: 'Test Response',
    subject: 'math',
    blocks,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. All 8 block types render their core content
// ─────────────────────────────────────────────────────────────────────────────

describe('FoxyStructuredRenderer — block-type coverage', () => {
  it('renders all 8 block types with their text/latex content visible', () => {
    const response: FoxyResponse = makeResponse([
      { type: 'paragraph', text: 'Paragraph content here' },
      { type: 'step', text: 'First step instruction' },
      { type: 'math', latex: 'x = 4' },
      { type: 'answer', text: 'Forty-two' },
      { type: 'exam_tip', text: 'Watch the units' },
      { type: 'definition', label: 'Force', text: 'Force is mass times acceleration' },
      { type: 'example', text: 'A 2 kg ball at 3 m/s squared' },
      { type: 'question', text: 'What is acceleration?' },
    ]);

    mockIsHi.value = false;
    render(<FoxyStructuredRenderer response={response} />);

    // Title
    expect(screen.getByText('Test Response')).toBeInTheDocument();

    // Each block's prose content
    expect(screen.getByText('Paragraph content here')).toBeInTheDocument();
    expect(screen.getByText('First step instruction')).toBeInTheDocument();
    expect(screen.getByText('Forty-two')).toBeInTheDocument();
    expect(screen.getByText('Watch the units')).toBeInTheDocument();
    expect(
      screen.getByText('Force is mass times acceleration'),
    ).toBeInTheDocument();
    expect(screen.getByText('A 2 kg ball at 3 m/s squared')).toBeInTheDocument();
    expect(screen.getByText('What is acceleration?')).toBeInTheDocument();

    // Chrome labels in English (default)
    expect(screen.getByText('Answer')).toBeInTheDocument();
    expect(screen.getByText('Exam Tip')).toBeInTheDocument();
    // Definition block uses block.label when present, falling back to "Definition".
    expect(screen.getByText('Force')).toBeInTheDocument();
    expect(screen.getByText('Example')).toBeInTheDocument();
    expect(screen.getByText('Practice')).toBeInTheDocument();
  });

  it('definition block falls back to "Definition" label when block.label absent', () => {
    mockIsHi.value = false;
    const response = makeResponse([
      { type: 'definition', text: 'Some definition body' },
    ]);
    render(<FoxyStructuredRenderer response={response} />);
    expect(screen.getByText('Definition')).toBeInTheDocument();
    expect(screen.getByText('Some definition body')).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Step numbering — consecutive vs reset
// ─────────────────────────────────────────────────────────────────────────────

describe('FoxyStructuredRenderer — step numbering', () => {
  it('numbers two consecutive step blocks 1, 2', () => {
    mockIsHi.value = false;
    const response = makeResponse([
      { type: 'step', text: 'First' },
      { type: 'step', text: 'Second' },
    ]);
    render(<FoxyStructuredRenderer response={response} />);

    // Step number circles render the integer as text.
    expect(screen.getByLabelText('Step 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Step 2')).toBeInTheDocument();
  });

  it('resets numbering after a non-step block intervenes', () => {
    mockIsHi.value = false;
    const response = makeResponse([
      { type: 'step', text: 'First A' },
      { type: 'step', text: 'Second A' },
      { type: 'paragraph', text: 'A note in between' },
      { type: 'step', text: 'First B' }, // resets to 1
      { type: 'step', text: 'Second B' }, // 2
    ]);
    render(<FoxyStructuredRenderer response={response} />);

    // We should see Step 1 and Step 2 each rendered TWICE — once before the
    // paragraph, once after.
    expect(screen.getAllByLabelText('Step 1')).toHaveLength(2);
    expect(screen.getAllByLabelText('Step 2')).toHaveLength(2);
    // Step 3 must NOT exist — the reset is the whole point.
    expect(screen.queryByLabelText('Step 3')).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. KaTeX fallback for invalid LaTeX
// ─────────────────────────────────────────────────────────────────────────────

describe('FoxyStructuredRenderer — math fallback', () => {
  // Mismatched-brace input that KaTeX (throwOnError:false) renders as a
  // span.katex-error rather than a real formula. This is the empirically
  // verified failure trigger.
  const BROKEN_LATEX = '\\frac{1';

  it('renders fallback (no throw) when KaTeX cannot parse the latex', () => {
    mockIsHi.value = false;
    const onReportIssue = vi.fn();
    const response = makeResponse([
      { type: 'math', latex: BROKEN_LATEX },
    ]);

    // The render itself must not throw.
    expect(() => {
      render(
        <FoxyStructuredRenderer
          response={response}
          onReportIssue={onReportIssue}
        />,
      );
    }).not.toThrow();

    // Fallback chrome must be visible.
    expect(screen.getByText('Issue with formula')).toBeInTheDocument();

    // Original latex must be preserved verbatim in the <code> fallback so the
    // user/support can see what failed.
    expect(screen.getByText(BROKEN_LATEX)).toBeInTheDocument();

    // The reporter button is wired to the callback.
    const button = screen.getByRole('button', { name: /Report issue/i });
    fireEvent.click(button);
    expect(onReportIssue).toHaveBeenCalledTimes(1);
  });

  it('hides the report button when onReportIssue prop is omitted', () => {
    mockIsHi.value = false;
    const response = makeResponse([
      { type: 'math', latex: BROKEN_LATEX },
    ]);
    render(<FoxyStructuredRenderer response={response} />);
    // Fallback header is still shown so the user knows something is wrong…
    expect(screen.getByText('Issue with formula')).toBeInTheDocument();
    // …but no actionable button.
    expect(
      screen.queryByRole('button', { name: /Report issue/i }),
    ).not.toBeInTheDocument();
  });

  it('renders valid LaTeX as KaTeX HTML (no fallback shown)', () => {
    mockIsHi.value = false;
    const response = makeResponse([
      { type: 'math', latex: 'x = 4' },
    ]);
    const { container } = render(
      <FoxyStructuredRenderer response={response} />,
    );
    // KaTeX-rendered content lives in a div with the .katex-render wrapper
    // class. The error chrome ("Issue with formula") must NOT appear.
    expect(screen.queryByText('Issue with formula')).not.toBeInTheDocument();
    expect(container.querySelector('.katex-render')).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Bilingual chrome (P7)
// ─────────────────────────────────────────────────────────────────────────────

describe('FoxyStructuredRenderer — bilingual chrome (P7)', () => {
  it('renders Hindi chrome strings when isHi is true', () => {
    mockIsHi.value = true;
    const response = makeResponse([
      { type: 'answer', text: 'चालीस' },
      { type: 'exam_tip', text: 'इकाइयाँ देखें' },
      { type: 'definition', text: 'बल का मतलब है' },
      { type: 'example', text: 'एक उदाहरण' },
      { type: 'question', text: 'अब आप बताइए' },
    ]);
    render(<FoxyStructuredRenderer response={response} />);

    // All 5 Hindi chrome labels should be present.
    // "परीक्षा सुझाव" is the standard NCERT Hindi term for "Exam Tip"; the
    // prior "परीक्षा टिप" was Hinglish (loaned the English word "टिप").
    expect(screen.getByText('उत्तर')).toBeInTheDocument();
    expect(screen.getByText('परीक्षा सुझाव')).toBeInTheDocument();
    expect(screen.getByText('परिभाषा')).toBeInTheDocument();
    expect(screen.getByText('उदाहरण')).toBeInTheDocument();
    expect(screen.getByText('अभ्यास')).toBeInTheDocument();

    // English chrome must NOT leak through when Hindi is active.
    expect(screen.queryByText('Answer')).not.toBeInTheDocument();
    expect(screen.queryByText('Exam Tip')).not.toBeInTheDocument();
    expect(screen.queryByText('Practice')).not.toBeInTheDocument();
  });

  it('renders Hindi error chrome on math fallback when isHi is true', () => {
    mockIsHi.value = true;
    const response = makeResponse([
      // Mismatched-brace input — see KaTeX-fallback test block above.
      { type: 'math', latex: '\\frac{1' },
    ]);
    render(
      <FoxyStructuredRenderer response={response} onReportIssue={vi.fn()} />,
    );
    expect(screen.getByText('सूत्र में समस्या')).toBeInTheDocument();
    // Reporter button label localises too.
    expect(
      screen.getByRole('button', { name: /समस्या रिपोर्ट करें/ }),
    ).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. isFoxyResponse type guard
// ─────────────────────────────────────────────────────────────────────────────

describe('isFoxyResponse', () => {
  it('returns true for a structurally valid FoxyResponse', () => {
    const valid: FoxyResponse = {
      title: 'Hello',
      subject: 'math',
      blocks: [{ type: 'paragraph', text: 'hi' }],
    };
    expect(isFoxyResponse(valid)).toBe(true);
  });

  it('returns false for a string', () => {
    expect(isFoxyResponse('just a markdown string')).toBe(false);
  });

  it('returns false for null / undefined / non-objects', () => {
    expect(isFoxyResponse(null)).toBe(false);
    expect(isFoxyResponse(undefined)).toBe(false);
    expect(isFoxyResponse(42)).toBe(false);
    expect(isFoxyResponse([])).toBe(false);
  });

  it('returns false when blocks is missing or empty', () => {
    expect(
      isFoxyResponse({ title: 'x', subject: 'math', blocks: [] }),
    ).toBe(false);
    expect(
      isFoxyResponse({ title: 'x', subject: 'math' }),
    ).toBe(false);
  });

  it('returns false when title is missing or empty', () => {
    expect(
      isFoxyResponse({
        title: '',
        subject: 'math',
        blocks: [{ type: 'paragraph', text: 'hi' }],
      }),
    ).toBe(false);
    expect(
      isFoxyResponse({
        subject: 'math',
        blocks: [{ type: 'paragraph', text: 'hi' }],
      }),
    ).toBe(false);
  });

  it('returns false when first block lacks a type field', () => {
    expect(
      isFoxyResponse({
        title: 'x',
        subject: 'math',
        blocks: [{ text: 'hi' }],
      }),
    ).toBe(false);
  });
});
