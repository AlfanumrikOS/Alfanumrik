/**
 * Cosmic redesign — Phase 0 presentational primitives.
 *
 * Scope: the flag-OFF safety guarantees and defensive value-handling of the
 * cosmic primitives that ship in Phase 0. These are PRESENTATIONAL components
 * only — they must never compute a score, an XP value, or a mastery threshold
 * (those belong to the assessment domain, P1/P2). The tests here pin:
 *
 *   1. FoxyMark renders the legacy "classic" geometric fox by DEFAULT, so every
 *      existing call site (flag OFF) is byte-identical to today. The "cosmic"
 *      variant only renders the SVG when explicitly asked for.
 *   2. MasteryRing / ProgressBar treat `percent` as a display-only input: they
 *      CLAMP to [0,100] and coerce non-finite input to 0, and they expose the
 *      value via aria-valuenow WITHOUT deriving it from any quiz math.
 *
 * We deliberately do not test third-party libs (clsx/tailwind-merge) or CSS
 * rendering — JSDOM doesn't apply the html[data-design="cosmic"] scope, which
 * is exactly the point: these components are inert without the flag.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { FoxyMark } from '@/components/landing/FoxyMark';
import { MasteryRing } from '@/components/cosmic/MasteryRing';
import { ProgressBar } from '@/components/cosmic/ProgressBar';

describe('FoxyMark — variant default (flag-OFF pixel identity)', () => {
  it('renders the classic geometric fox by default (no variant prop)', () => {
    const { container } = render(<FoxyMark />);
    // Classic fox is a div tree of absolutely-positioned shapes — NO <svg>.
    expect(container.querySelector('svg')).toBeNull();
    // The classic base node carries the legacy aria-hidden wrapper.
    const wrapper = container.querySelector('[aria-hidden="true"]');
    expect(wrapper).not.toBeNull();
  });

  it('renders the classic fox when variant is explicitly "classic"', () => {
    const { container } = render(<FoxyMark variant="classic" />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('renders the cosmic SVG fox only when variant="cosmic"', () => {
    const { container } = render(<FoxyMark variant="cosmic" />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    // The cosmic wrapper is the float container; mascot is decorative.
    expect(container.querySelector('.cosmic-float')).not.toBeNull();
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('classic markup does not change shape across the three sizes', () => {
    for (const size of ['sm', 'md', 'lg'] as const) {
      const { container } = render(<FoxyMark size={size} />);
      // Every size is still the classic (svg-free) fox.
      expect(container.querySelector('svg')).toBeNull();
    }
  });
});

describe('MasteryRing — display-only, defensive value handling (P1 is NOT here)', () => {
  it('exposes the percent verbatim via aria-valuenow for an in-range value', () => {
    const { container } = render(<MasteryRing percent={73} label="Algebra mastery" />);
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar).not.toBeNull();
    expect(bar!.getAttribute('aria-valuenow')).toBe('73');
    expect(bar!.getAttribute('aria-valuemin')).toBe('0');
    expect(bar!.getAttribute('aria-valuemax')).toBe('100');
    expect(bar!.getAttribute('aria-label')).toBe('Algebra mastery');
  });

  it('clamps an over-100 percent down to 100 (no overflow ring)', () => {
    const { container } = render(<MasteryRing percent={150} />);
    expect(
      container.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow'),
    ).toBe('100');
  });

  it('clamps a negative percent up to 0', () => {
    const { container } = render(<MasteryRing percent={-25} />);
    expect(
      container.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow'),
    ).toBe('0');
  });

  it('coerces NaN to 0 rather than rendering "NaN" (division-by-zero guard)', () => {
    const { container } = render(<MasteryRing percent={Number.NaN} />);
    expect(
      container.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow'),
    ).toBe('0');
  });

  it('coerces Infinity to 0 (non-finite guard runs before the clamp)', () => {
    // The component does `Number.isFinite(percent) ? percent : 0` FIRST, so a
    // non-finite input becomes 0 and never an infinite/100% ring. This is the
    // safer choice: a garbage value reads as "no progress", not "complete".
    const { container } = render(<MasteryRing percent={Number.POSITIVE_INFINITY} />);
    expect(
      container.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow'),
    ).toBe('0');
  });

  it('rounds aria-valuenow but never recomputes a score from correct/total', () => {
    // 33.6 is a display rounding concern only; the component must NOT know about
    // (correct/total)*100 — that is submitQuizResults()'s job (P1). It just
    // rounds whatever display number it was handed.
    const { container } = render(<MasteryRing percent={33.6} />);
    expect(
      container.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow'),
    ).toBe('34');
  });
});

describe('ProgressBar — display-only, defensive value handling', () => {
  it('exposes an in-range percent via aria-valuenow and a clamped fill width', () => {
    const { container } = render(<ProgressBar percent={40} label="Daily goal" />);
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar!.getAttribute('aria-valuenow')).toBe('40');
    expect(bar!.getAttribute('aria-label')).toBe('Daily goal');
    const fill = bar!.querySelector('span') as HTMLElement | null;
    expect(fill).not.toBeNull();
    expect(fill!.style.width).toBe('40%');
  });

  it('clamps the fill width to 100% for an over-range percent', () => {
    const { container } = render(<ProgressBar percent={250} />);
    const bar = container.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute('aria-valuenow')).toBe('100');
    expect((bar.querySelector('span') as HTMLElement).style.width).toBe('100%');
  });

  it('clamps the fill width to 0% for a negative percent', () => {
    const { container } = render(<ProgressBar percent={-10} />);
    const bar = container.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute('aria-valuenow')).toBe('0');
    expect((bar.querySelector('span') as HTMLElement).style.width).toBe('0%');
  });

  it('coerces non-finite percent to a 0% fill (never "NaN%")', () => {
    const { container } = render(<ProgressBar percent={Number.NaN} />);
    const bar = container.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute('aria-valuenow')).toBe('0');
    expect((bar.querySelector('span') as HTMLElement).style.width).toBe('0%');
  });
});
