import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

/* ═══════════════════════════════════════════════════════════════════════════
   WrittenAnswerInput — CTA background token pin

   THE BUG THIS PINS (fixed 2026-08-24)
   ────────────────────────────────────
   Lines 234 and 261 of packages/ui/src/quiz/ncert/WrittenAnswerInput.tsx used
   to paint the primary CTA with:

       background: 'var(--btn-primary)'            // line 234
       background: 'var(--btn-primary-gradient)'   // line 261

   Neither custom property is defined ANYWHERE in the codebase. What exists is
   `--btn-primary-from` / `--btn-primary-to` (the gradient STOPS) and the
   canonical composed token `--surface-accent`, defined as
   `linear-gradient(135deg, var(--btn-primary-from), var(--btn-primary-to))`.

   Referencing an undefined custom property does not fall back to anything. It
   makes the declaration "invalid at computed-value time", so `background`
   resolves to its initial value — transparent. The button's text is
   `text-white`, so the moment a student typed a single character the CTA
   swapped from the grey `#767676` empty state to white-on-transparent: an
   invisible button on the primary answer-submission path.

   Both sites now use `var(--surface-accent)`.

   WHY THE ASSERTIONS READ THE style ATTRIBUTE STRING
   ──────────────────────────────────────────────────
   JSDOM has no cascade and no custom-property resolution: it cannot tell a
   defined token from an undefined one, and `getComputedStyle().background`
   would be equally empty for both. So computed colour proves nothing here.
   What JSDOM DOES preserve verbatim is the serialised inline `style`
   attribute, and the identity of the token in that string is precisely the
   thing that broke. Matching on it is the repo idiom — see
   apps/host/src/__tests__/ui-primitives.test.tsx:26.

   NOTE ON `#767676`: JSDOM's cssstyle normalises hex colours to the rgb()
   functional form, so the empty-state style attribute serialises as
   `background: rgb(118, 118, 118);` (0x76 === 118). The regex below accepts
   either spelling — same colour, different serialisation, no assertion
   weakened.

   SCOPE NOTE: two existing suites deliberately mock this component to
   `() => null` (quiz-practice-v2-check-answer.test.tsx:211 and
   quiz-foxy-phase0.test.tsx:203). Those are page-level tests that do not care
   about the answer pad. THIS file imports the REAL component — that is the
   whole point, and it must stay that way.
   ═══════════════════════════════════════════════════════════════════════════ */

// Mutable auth state — the established convention for P7 language toggling
// (see QuizResults.goal-flag.test.tsx:45).
let authState: { isHi: boolean } = { isHi: false };
vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => authState,
}));

// MathRenderer pulls in KaTeX; every component test in this repo stubs it.
vi.mock('@alfanumrik/ui/math/MathRenderer', () => ({
  default: ({ content }: { content: string }) => content,
}));

import WrittenAnswerInput from '@alfanumrik/ui/quiz/ncert/WrittenAnswerInput';

/**
 * THE LOAD-BEARING GUARD.
 *
 * `var(--btn-primary)` and `var(--btn-primary-gradient)` are references to
 * CSS custom properties that DO NOT EXIST. Either one makes `background`
 * invalid-at-computed-value-time → transparent → an invisible white-on-nothing
 * button. This must never appear in any state of this component.
 *
 * Deliberately narrow: `var(--btn-primary-from)` / `var(--btn-primary-to)` are
 * REAL tokens and are not matched (the `\)` anchors the alternation).
 */
const UNDEFINED_TOKEN = /var\(--btn-primary(-gradient)?\)/;

/** The canonical, defined gradient token both CTAs must now use. */
const SURFACE_ACCENT = /var\(--surface-accent\)/;

/**
 * The disabled/empty grey. JSDOM serialises `#767676` as `rgb(118, 118, 118)`.
 */
const EMPTY_GREY = /#767676|rgb\(\s*118,\s*118,\s*118\s*\)/i;

const BASE_PROPS = {
  questionText: 'Define photosynthesis.',
  questionType: 'short_answer' as const,
  marksP: 2,
  wordLimit: 30,
  timeEstimate: 120,
  questionNumber: 1,
  totalQuestions: 5,
  isEvaluating: false,
};

function renderPad(overrides: Partial<React.ComponentProps<typeof WrittenAnswerInput>> = {}) {
  const onSubmit = vi.fn();
  const onSkip = vi.fn();
  const utils = render(
    <WrittenAnswerInput
      {...BASE_PROPS}
      onSubmit={onSubmit}
      onSkip={onSkip}
      {...overrides}
    />,
  );
  return { ...utils, onSubmit, onSkip };
}

/** The answer textarea (id="answer-input"). */
function textarea(): HTMLTextAreaElement {
  return screen.getByRole('textbox') as HTMLTextAreaElement;
}

/**
 * The primary CTA on the compose screen. Identified by its aria-label, which
 * is the only stable handle across the empty / non-empty label swap.
 */
function primaryCta(): HTMLButtonElement {
  const btn =
    screen.queryByRole('button', { name: /submit empty answer/i }) ??
    screen.queryByRole('button', { name: /review your answer before submitting/i }) ??
    screen.queryByRole('button', { name: /खाली उत्तर सबमिट करें/ }) ??
    screen.queryByRole('button', { name: /सबमिट करने से पहले अपना उत्तर देखें/ });
  if (!btn) throw new Error('primary CTA not found on the compose screen');
  return btn as HTMLButtonElement;
}

function styleOf(el: Element): string {
  return el.getAttribute('style') ?? '';
}

beforeEach(() => {
  authState = { isHi: false };
});
afterEach(() => cleanup());

describe('WrittenAnswerInput — CTA background uses a DEFINED token', () => {
  it('empty answer: CTA paints the grey empty state and reads "Submit Empty"', () => {
    renderPad();
    const cta = primaryCta();

    expect(styleOf(cta)).toMatch(EMPTY_GREY);
    expect(cta.textContent?.trim()).toBe('Submit Empty');
    // Guard: even the grey state must not reference the phantom token.
    expect(styleOf(cta)).not.toMatch(UNDEFINED_TOKEN);
  });

  it('typing flips the CTA to var(--surface-accent) and "Review Answer →"', () => {
    renderPad();

    fireEvent.change(textarea(), {
      target: { value: 'Photosynthesis converts light energy into chemical energy.' },
    });

    const cta = primaryCta();
    expect(styleOf(cta)).toMatch(SURFACE_ACCENT);
    expect(cta.textContent?.trim()).toBe('Review Answer →');
    // THE REGRESSION: this style attribute used to read `var(--btn-primary)`,
    // an undefined property → transparent background → invisible white text.
    expect(styleOf(cta)).not.toMatch(UNDEFINED_TOKEN);
    // The grey empty-state colour must be gone once there is an answer.
    expect(styleOf(cta)).not.toMatch(EMPTY_GREY);
  });

  it('the CTA is ENABLED with text present (the bug was visibility, not enablement)', () => {
    renderPad();
    fireEvent.change(textarea(), { target: { value: 'Some answer.' } });

    const cta = primaryCta();
    // It was never disabled — which is exactly why the invisible-button bug
    // was so damaging: the control still worked, students just could not see
    // it. Pinning this stops a future "fix" from disabling the button instead
    // of restoring its background.
    expect(cta.disabled).toBe(false);
  });

  it('review screen: "Submit for Evaluation →" also paints var(--surface-accent)', () => {
    renderPad();

    fireEvent.change(textarea(), { target: { value: 'A complete written answer.' } });
    fireEvent.click(primaryCta()); // → review screen

    const submit = screen.getByRole('button', { name: /submit for evaluation/i });
    expect(styleOf(submit)).toMatch(SURFACE_ACCENT);
    // THE REGRESSION at line 261: used to be `var(--btn-primary-gradient)`.
    expect(styleOf(submit)).not.toMatch(UNDEFINED_TOKEN);
  });

  it('no element in ANY state references an undefined --btn-primary* property', () => {
    const { container } = renderPad();

    const assertClean = (phase: string) => {
      for (const el of Array.from(container.querySelectorAll('[style]'))) {
        expect(
          styleOf(el),
          `${phase}: <${el.tagName.toLowerCase()}> references an UNDEFINED CSS custom ` +
            'property. `var(--btn-primary)` / `var(--btn-primary-gradient)` are defined ' +
            'nowhere in the codebase; the declaration becomes invalid at computed-value ' +
            'time and the background resolves to transparent. Use var(--surface-accent) ' +
            '(or the real stops --btn-primary-from / --btn-primary-to).',
        ).not.toMatch(UNDEFINED_TOKEN);
      }
    };

    assertClean('empty');
    fireEvent.change(textarea(), { target: { value: 'An answer.' } });
    assertClean('typed');
    fireEvent.click(primaryCta());
    assertClean('reviewing');
  });
});

describe('WrittenAnswerInput — bilingual CTA labels (P7)', () => {
  it('isHi renders the Hindi labels and keeps the same background tokens', () => {
    authState = { isHi: true };
    renderPad();

    const empty = primaryCta();
    expect(empty.textContent?.trim()).toBe('खाली सबमिट करें');
    expect(styleOf(empty)).toMatch(EMPTY_GREY);

    fireEvent.change(textarea(), { target: { value: 'प्रकाश संश्लेषण एक प्रक्रिया है।' } });

    const filled = primaryCta();
    expect(filled.textContent?.trim()).toBe('उत्तर देखें →');
    expect(styleOf(filled)).toMatch(SURFACE_ACCENT);
    expect(styleOf(filled)).not.toMatch(UNDEFINED_TOKEN);

    fireEvent.click(filled);

    const submit = screen.getByRole('button', { name: /मूल्यांकन के लिए सबमिट करें/ });
    expect(submit.textContent?.trim()).toBe('मूल्यांकन के लिए सबमिट करें →');
    expect(styleOf(submit)).toMatch(SURFACE_ACCENT);
    expect(styleOf(submit)).not.toMatch(UNDEFINED_TOKEN);
  });

  it('English and Hindi differ (guards against an untranslated fallback)', () => {
    authState = { isHi: false };
    renderPad();
    const en = primaryCta().textContent?.trim();
    cleanup();

    authState = { isHi: true };
    renderPad();
    const hi = primaryCta().textContent?.trim();

    expect(en).toBe('Submit Empty');
    expect(hi).toBe('खाली सबमिट करें');
    expect(hi).not.toBe(en);
  });
});
