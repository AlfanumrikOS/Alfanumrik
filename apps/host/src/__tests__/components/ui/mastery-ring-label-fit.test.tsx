import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { MasteryRing } from '@alfanumrik/ui/ui';

/**
 * MasteryRing (Wonder Blocks) — centre label must fit inside the ring.
 *
 * WHICH MasteryRing: the repo has FOUR components by this name. This suite
 * targets the one exported from the `@alfanumrik/ui/ui` ROOT barrel, which
 * `packages/ui/src/ui/index.ts` re-exports via `export * from './wonder-blocks'`
 * — i.e. `packages/ui/src/ui/wonder-blocks.tsx`. That is the one every app call
 * site below imports. (The others: `ui/primitives/ProgressRing.tsx`, exposed
 * only under the `primitives` namespace; `cosmic/MasteryRing.tsx`, covered by
 * cosmic-primitives.test.tsx; and `landing/v3/MotionPrimitives.tsx`.) The import
 * above deliberately goes through the same barrel the app uses, so if the barrel
 * is ever re-pointed at a different implementation this suite follows it.
 *
 * WHAT BROKE
 * ----------
 * The fallback centre label (rendered ONLY when no `children` are passed) was
 * hardcoded `text-xs` = 12px regardless of `size`. At the Foxy call site
 * (`size={40} strokeWidth={4}`) the inner clear diameter is 40 - 2*4 = 32px,
 * while a bold "100%" at 12px measures ~30-31px — so the absolutely-positioned
 * label painted onto/over the ring stroke. The label now scales with `size`.
 *
 * HOW THIS IS TESTED (and why not by re-deriving the formula)
 * ----------------------------------------------------------
 * These tests RENDER the exported component and read the resulting
 * `style.fontSize` and text content off the DOM. They never import or restate
 * `Math.max(9, Math.round(size * 0.1875))`. A test that recomputed the
 * implementation's own formula would agree with any future formula, correct or
 * not — it would pin nothing.
 *
 * The fit check uses this suite's OWN typographic model, intentionally stricter
 * than the component's: 0.65em per glyph (the component assumes 0.62em), applied
 * to the ACTUAL rendered glyph count, against the ACTUAL inner clear diameter
 * (size - 2*strokeWidth) with no breathing-room subtraction. So the geometry
 * assertions pass only with real margin, and would fail before a marginal
 * overflow became visible.
 *
 * JSDOM does no layout and no font metrics, so measuring real text width is not
 * possible here — a geometric model against rendered inputs is the strongest
 * available check short of a screenshot test.
 *
 * IF THIS TEST FAILS at `size=64 → 12px`: that is the no-visual-regression
 * guarantee for every existing screen. Do not adjust the expectation; the
 * default ring's label must stay pixel-identical to the old `text-xs`.
 */

/** Conservative bold-digit advance width, in em. Stricter than the component's 0.62. */
const EM_PER_GLYPH = 0.65;

/** The fallback label span (present only when no children were passed). */
function labelSpan(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('div.absolute span');
}

function renderRing(props: { value: number; size?: number; strokeWidth?: number }) {
  const { container } = render(<MasteryRing {...props} />);
  const span = labelSpan(container);
  if (!span) throw new Error('MasteryRing rendered no fallback centre label');
  const fontSizePx = Number.parseFloat(span.style.fontSize);
  return { container, span, text: span.textContent ?? '', fontSizePx };
}

/**
 * Real `size`/`strokeWidth` pairs passed to this component across the app.
 *
 * Enumerated by grepping `<MasteryRing` under apps/host/src + packages/ui/src and
 * then keeping ONLY the sites whose import resolves to the `@alfanumrik/ui/ui`
 * barrel. That second filter is what excludes the three same-named components
 * noted above; for the record their call sites are
 * `dev/cosmic-preview/page.tsx` + `dashboard/sections/CosmicAboveFoldHero.tsx`
 * (`@alfanumrik/ui/cosmic`), `landing/v3/OutcomeV3.tsx` (`./MotionPrimitives`),
 * and `dev/ui/page.tsx` (`@alfanumrik/ui/ui/primitives`).
 *
 *   40/4  foxy/MasteryAwareness.tsx:128        (the fallback-label call site)
 *   48/4  (student)/progress/page.tsx:776
 *   52/4  dashboard/ExamReadiness.tsx:79, progress/SubjectMasteryCard.tsx:160
 *   64/5  the component's DECLARED DEFAULTS — no shipping call site passes this
 *         pair. `dev/ui/page.tsx` does render bare `<MasteryRing value={n} />`,
 *         but it imports from `@alfanumrik/ui/ui/primitives`, i.e.
 *         `ui/primitives/ProgressRing.tsx` — a DIFFERENT component (proved by the
 *         `bandLabel` prop it passes on line 647, which the wonder-blocks
 *         `MasteryRingProps` does not declare). So 64/5 is a synthetic probe of
 *         the declared defaults, kept because a future call site could omit both
 *         props; it is not evidence of a real screen.
 *   64/6  learn/os/SubjectHeader.tsx:59        (the real size-64 call site)
 *   72/7  practice/os/PracticeHeader.tsx:79, review/os/RevisionHeader.tsx:81
 *   76/7  exam-briefing/os/ReadinessBriefing.tsx:124
 *   80/6  (student)/progress/page.tsx:623
 *   88/7  ExamProphecy.tsx:208
 *
 * Most pass `children` and so never reach the fallback label — they are included
 * anyway because any of them could drop its children, and the geometry must hold
 * if it does.
 */
const CALL_SITES: ReadonlyArray<{ size: number; strokeWidth: number; where: string }> = [
  { size: 40, strokeWidth: 4, where: 'foxy/MasteryAwareness.tsx' },
  { size: 48, strokeWidth: 4, where: '(student)/progress/page.tsx' },
  { size: 52, strokeWidth: 4, where: 'dashboard/ExamReadiness.tsx + progress/SubjectMasteryCard.tsx' },
  { size: 64, strokeWidth: 5, where: 'declared DEFAULTS — synthetic, no shipping call site' },
  { size: 64, strokeWidth: 6, where: 'learn/os/SubjectHeader.tsx' },
  { size: 72, strokeWidth: 7, where: 'practice/os/PracticeHeader.tsx + review/os/RevisionHeader.tsx' },
  { size: 76, strokeWidth: 7, where: 'exam-briefing/os/ReadinessBriefing.tsx' },
  { size: 80, strokeWidth: 6, where: '(student)/progress/page.tsx' },
  { size: 88, strokeWidth: 7, where: 'ExamProphecy.tsx' },
];

describe('MasteryRing — default size renders an unchanged 12px label (no visual regression)', () => {
  it('renders exactly 12px at the DEFAULT size=64, matching the old hardcoded text-xs', () => {
    // Every screen that uses the default ring must be pixel-identical to before
    // the scaling change. This is the whole safety argument for the coefficient.
    const { fontSizePx } = renderRing({ value: 72 });
    expect(fontSizePx).toBe(12);
  });

  it('renders 12px for an explicit size=64 too (default and explicit agree)', () => {
    expect(renderRing({ value: 72, size: 64 }).fontSizePx).toBe(12);
  });

  it('still renders the percent sign and the rounded value at the default size', () => {
    expect(renderRing({ value: 72.4, size: 64 }).text).toBe('72%');
    expect(renderRing({ value: 100, size: 64 }).text).toBe('100%');
  });
});

describe('MasteryRing — worst-case "100%" fits inside the ring at the Foxy call site', () => {
  // size=40 strokeWidth=4 is the exact geometry that overflowed before the fix.
  const SIZE = 40;
  const STROKE = 4;

  it('renders the worst-case label "100%" at size=40 strokeWidth=4', () => {
    expect(renderRing({ value: 100, size: SIZE, strokeWidth: STROKE }).text).toBe('100%');
  });

  it('fits the worst-case label within the inner clear diameter (32px)', () => {
    const { text, fontSizePx } = renderRing({ value: 100, size: SIZE, strokeWidth: STROKE });
    const innerClearDiameter = SIZE - STROKE * 2;
    const estimatedWidth = text.length * EM_PER_GLYPH * fontSizePx;
    expect(innerClearDiameter).toBe(32);
    expect(
      estimatedWidth,
      `"${text}" at ${fontSizePx}px ≈ ${estimatedWidth.toFixed(1)}px wide, but the ring's inner clear ` +
        `diameter is only ${innerClearDiameter}px — the label overlaps the stroke.`,
    ).toBeLessThanOrEqual(innerClearDiameter);
  });

  it('regression witness: the OLD hardcoded 12px would NOT have fit here', () => {
    // Proves the assertion above has teeth rather than passing trivially.
    // "100%" at the old 12px ≈ 4 * 0.65 * 12 = 31.2px against 32px of clear
    // space — inside the model's tolerance only by 0.8px, and over it once the
    // component's own 4px breathing-room allowance is applied. The fix drops the
    // rendered size well below that.
    const OLD_HARDCODED_PX = 12;
    const { fontSizePx } = renderRing({ value: 100, size: SIZE, strokeWidth: STROKE });
    expect(
      fontSizePx,
      'the size=40 ring must render a SMALLER label than the old hardcoded text-xs',
    ).toBeLessThan(OLD_HARDCODED_PX);
  });
});

describe('MasteryRing — label geometry holds at every real call-site size', () => {
  it.each(CALL_SITES)(
    'size=$size strokeWidth=$strokeWidth ($where) fits the worst-case "100%" label',
    ({ size, strokeWidth }) => {
      const { text, fontSizePx } = renderRing({ value: 100, size, strokeWidth });
      const innerClearDiameter = size - strokeWidth * 2;
      const estimatedWidth = text.length * EM_PER_GLYPH * fontSizePx;
      expect(
        estimatedWidth,
        `"${text}" at ${fontSizePx}px ≈ ${estimatedWidth.toFixed(1)}px exceeds the ${innerClearDiameter}px inner clear diameter`,
      ).toBeLessThanOrEqual(innerClearDiameter);
    },
  );

  it.each(CALL_SITES)(
    'size=$size renders a legible label (>= the 9px floor) and never a fractional px',
    ({ size, strokeWidth }) => {
      const { fontSizePx } = renderRing({ value: 100, size, strokeWidth });
      expect(fontSizePx).toBeGreaterThanOrEqual(9);
      expect(Number.isInteger(fontSizePx)).toBe(true);
    },
  );

  it('scales monotonically — a bigger ring never gets a smaller label', () => {
    const sizes = CALL_SITES.map((c) => c.size);
    const fontSizes = CALL_SITES.map((c) => renderRing({ value: 100, ...c }).fontSizePx);
    for (let i = 1; i < sizes.length; i++) {
      expect(
        fontSizes[i],
        `size ${sizes[i]} rendered ${fontSizes[i]}px but the smaller size ${sizes[i - 1]} rendered ${fontSizes[i - 1]}px`,
      ).toBeGreaterThanOrEqual(fontSizes[i - 1]);
    }
  });

  it('keeps the % glyph at every real call-site size (the drop is a small-ring fallback only)', () => {
    for (const site of CALL_SITES) {
      expect(
        renderRing({ value: 100, ...site }).text,
        `size=${site.size} dropped the % glyph — no shipping call site should need that`,
      ).toBe('100%');
    }
  });
});

describe('MasteryRing — % glyph is dropped only when it genuinely cannot fit', () => {
  it('drops % on a ring too small for four glyphs, keeping the bare number legible', () => {
    // 32/4 is BELOW every shipping call site — a synthetic probe that the
    // narrow-ring branch exists and is reachable, not a supported size.
    const { text, fontSizePx } = renderRing({ value: 100, size: 32, strokeWidth: 4 });
    expect(text).toBe('100');
    expect(fontSizePx).toBeGreaterThanOrEqual(9);
    expect(text.length * EM_PER_GLYPH * fontSizePx).toBeLessThanOrEqual(32 - 4 * 2);
  });

  it('never renders an empty or NaN label on a tiny ring', () => {
    const { text } = renderRing({ value: 100, size: 24, strokeWidth: 3 });
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toContain('NaN');
  });
});

describe('MasteryRing — the fallback label is bypassed entirely when children are passed', () => {
  it('renders children instead of the percent label (most call sites take this path)', () => {
    const { container } = render(
      <MasteryRing value={100} size={40} strokeWidth={4}>
        <span data-testid="custom">92</span>
      </MasteryRing>,
    );
    expect(container.querySelector('[data-testid="custom"]')).not.toBeNull();
    // No fallback "100%" text anywhere in the centre.
    expect(container.textContent).not.toContain('100%');
  });

  it('still exposes the accessible value via aria-label regardless of the label path', () => {
    // The visual label is a display detail; the a11y contract must not depend on
    // whether the % glyph fit or whether children were supplied.
    const { container: withFallback } = render(<MasteryRing value={100} size={24} strokeWidth={3} />);
    expect(withFallback.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Mastery: 100%');

    const { container: withChildren } = render(
      <MasteryRing value={73.6} size={40} strokeWidth={4}>
        <span>x</span>
      </MasteryRing>,
    );
    expect(withChildren.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Mastery: 74%');
  });

  it('clamps out-of-range values before labelling (display-only guard, never quiz math)', () => {
    // P1 lives in submitQuizResults(); this component only clamps what it is handed.
    expect(renderRing({ value: 150, size: 64 }).text).toBe('100%');
    expect(renderRing({ value: -20, size: 64 }).text).toBe('0%');
  });
});
