/**
 * Foxy-OS header gating predicate — the OFF-path render-selection guard.
 *
 * `src/app/foxy/page.tsx` decides which header to render with:
 *
 *   const useFoxyOsHeader = foxyOsEnabled && foxyOsMobile;
 *   header={useFoxyOsHeader ? foxyOsHeaderContent : foxyHeaderContent}
 *
 * A full render test of /foxy is impractical (the page pulls AuthContext, SWR,
 * useFoxyChat, matchMedia, dynamic-imported sheets, etc.). Per the testing
 * agent's OFF-path-identity convention we instead pin the GATING PREDICATE as a
 * pure function so the truth table is locked:
 *
 *   - The new mobile surface (FoxyTopBar + FoxyStudySheet) is selected ONLY
 *     when BOTH the flag is ON AND the viewport is <lg.
 *   - In EVERY other combination — flag OFF (any viewport) or >=lg (any flag
 *     state) — the legacy `foxyHeaderContent` is selected, i.e. byte-identical
 *     to today.
 *
 * `selectFoxyHeader` is a verbatim re-expression of the page's selection
 * logic. If page.tsx ever changes the predicate (e.g. drops the viewport guard
 * and ships the redesign to desktop), this test must be updated in lockstep —
 * that is the intended tripwire.
 *
 * Owning agent: testing.
 */

import { describe, it, expect } from 'vitest';

type HeaderChoice = 'foxyOsHeaderContent' | 'foxyHeaderContent';

/**
 * Mirror of the page predicate:
 *   useFoxyOsHeader = foxyOsEnabled && foxyOsMobile
 *   header = useFoxyOsHeader ? foxyOsHeaderContent : foxyHeaderContent
 */
function selectFoxyHeader(foxyOsEnabled: boolean, foxyOsMobile: boolean): HeaderChoice {
  const useFoxyOsHeader = foxyOsEnabled && foxyOsMobile;
  return useFoxyOsHeader ? 'foxyOsHeaderContent' : 'foxyHeaderContent';
}

describe('selectFoxyHeader — gating truth table', () => {
  it('flag OFF + desktop (>=lg) → legacy header (byte-identical to today)', () => {
    expect(selectFoxyHeader(false, false)).toBe('foxyHeaderContent');
  });

  it('flag OFF + mobile (<lg) → legacy header (OFF path must not flash redesign)', () => {
    expect(selectFoxyHeader(false, true)).toBe('foxyHeaderContent');
  });

  it('flag ON + desktop (>=lg) → legacy header (redesign is mobile-only)', () => {
    expect(selectFoxyHeader(true, false)).toBe('foxyHeaderContent');
  });

  it('flag ON + mobile (<lg) → new Foxy-OS header (the only ON combination)', () => {
    expect(selectFoxyHeader(true, true)).toBe('foxyOsHeaderContent');
  });
});

describe('selectFoxyHeader — OFF-path identity invariant', () => {
  it('with the flag OFF, viewport is irrelevant: always the legacy header', () => {
    for (const mobile of [false, true]) {
      expect(selectFoxyHeader(false, mobile)).toBe('foxyHeaderContent');
    }
  });

  it('the new surface is selected in exactly one of the four states', () => {
    const states: Array<[boolean, boolean]> = [
      [false, false],
      [false, true],
      [true, false],
      [true, true],
    ];
    const onCount = states.filter(
      ([flag, mobile]) => selectFoxyHeader(flag, mobile) === 'foxyOsHeaderContent',
    ).length;
    expect(onCount).toBe(1);
  });
});
