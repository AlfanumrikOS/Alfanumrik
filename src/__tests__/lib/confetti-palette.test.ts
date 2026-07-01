/**
 * confetti-palette.ts — brand-hex contract for canvas-confetti / CSS confetti.
 *
 * WHY THIS TEST EXISTS:
 *   canvas-confetti consumes LITERAL hex strings at call time — it cannot read
 *   CSS custom properties (`var(--accent-warm)`). The "Alfa Momentum" Wave 5
 *   de-arcade work replaced ad-hoc rainbow arrays (e.g.
 *   ['#FFD700','#FFA500',...]) with these brand-aligned palettes. This test
 *   pins three things so the palette can never silently drift:
 *     1. every exported palette is an ARRAY of valid 6-digit hex strings
 *        (NOT tokens / var() — canvas-confetti would render those invisible);
 *     2. the four canonical brand hues are present where expected
 *        (warm #E8581C, gold #F5A623, purple #7C3AED, green #16A34A);
 *     3. the de-arcade intent holds — no legacy arcade hues leak back in
 *        (#FFD700 gold-yellow, #FFA500 orange, #F97316 old Tailwind orange).
 *
 * PRESENTATION-ONLY: asserts string constants, no engine/scoring logic (P1/P2
 * untouched). Pairs with the token-purity scans in
 * momentum-wave2-visuals.test.tsx (those guard inline-style tokens; this guards
 * the JS-side literal-hex arrays canvas-confetti requires).
 */

import { describe, it, expect } from 'vitest';
import {
  BRAND_CONFETTI,
  NEUTRAL_CONFETTI,
  WARM_CONFETTI,
  PURPLE_CONFETTI,
  CELEBRATION_CONFETTI,
  NEUTRAL_BURST,
  CHAIN_CONFETTI,
} from '@/lib/confetti-palette';

// Canonical brand hues (must stay in sync with globals.css :root tokens).
const BRAND = {
  warm: '#E8581C',
  warmDeep: '#C2440F',
  gold: '#F5A623',
  purple: '#7C3AED',
  green: '#16A34A',
} as const;

// A valid canvas-confetti colour is a literal 6-digit hex string.
const SIX_DIGIT_HEX = /^#[0-9A-Fa-f]{6}$/;

// Legacy "arcade" hues the Wave 5 de-arcade pass intentionally removed.
const FORBIDDEN_ARCADE_HEX = [
  '#FFD700', // arcade gold-yellow
  '#FFA500', // arcade orange
  '#F97316', // old Tailwind orange-500 brand hex (now token --accent-warm → #E8581C)
];

const ALL_PALETTE_ARRAYS: Array<[string, string[]]> = [
  ['WARM_CONFETTI', WARM_CONFETTI],
  ['PURPLE_CONFETTI', PURPLE_CONFETTI],
  ['CELEBRATION_CONFETTI', CELEBRATION_CONFETTI],
  ['NEUTRAL_BURST', NEUTRAL_BURST],
  ['CHAIN_CONFETTI', CHAIN_CONFETTI],
];

describe('confetti-palette — exported arrays are valid 6-digit hex', () => {
  it.each(ALL_PALETTE_ARRAYS)(
    '%s is a non-empty array of valid 6-digit hex strings (canvas-confetti needs hex, not tokens)',
    (_name, palette) => {
      expect(Array.isArray(palette)).toBe(true);
      expect(palette.length).toBeGreaterThan(0);
      for (const color of palette) {
        expect(typeof color).toBe('string');
        expect(color).toMatch(SIX_DIGIT_HEX);
        // No CSS var()/token leakage — canvas-confetti can't resolve those.
        expect(color).not.toMatch(/var\(/);
      }
    },
  );

  it('no palette contains a duplicate colour (each hue earns its slot)', () => {
    for (const [name, palette] of ALL_PALETTE_ARRAYS) {
      const unique = new Set(palette.map((c) => c.toUpperCase()));
      expect(unique.size, `${name} has duplicate hues`).toBe(palette.length);
    }
  });
});

describe('confetti-palette — brand hex constants are correct', () => {
  it('BRAND_CONFETTI carries the four canonical Alfa Momentum hues', () => {
    expect(BRAND_CONFETTI.warm).toBe(BRAND.warm); // #E8581C
    expect(BRAND_CONFETTI.gold).toBe(BRAND.gold); // #F5A623
    expect(BRAND_CONFETTI.purple).toBe(BRAND.purple); // #7C3AED
    expect(BRAND_CONFETTI.green).toBe(BRAND.green); // #16A34A
    expect(BRAND_CONFETTI.warmDeep).toBe(BRAND.warmDeep); // #C2440F
  });

  it('every BRAND_CONFETTI / NEUTRAL_CONFETTI value is a valid 6-digit hex', () => {
    for (const value of [
      ...Object.values(BRAND_CONFETTI),
      ...Object.values(NEUTRAL_CONFETTI),
    ]) {
      expect(value).toMatch(SIX_DIGIT_HEX);
    }
  });
});

describe('confetti-palette — brand hues land in the right palettes', () => {
  it('WARM_CONFETTI is a warm→gold ramp anchored on the brand warm + gold', () => {
    expect(WARM_CONFETTI).toContain(BRAND.warm);
    expect(WARM_CONFETTI).toContain(BRAND.gold);
  });

  it('PURPLE_CONFETTI is anchored on the brand purple', () => {
    expect(PURPLE_CONFETTI).toContain(BRAND.purple);
  });

  it('CELEBRATION_CONFETTI (perfect tier) mixes all four brand signal hues', () => {
    expect(CELEBRATION_CONFETTI).toEqual(
      expect.arrayContaining([BRAND.warm, BRAND.gold, BRAND.purple, BRAND.green]),
    );
  });

  it('NEUTRAL_BURST (good tier) is restrained silver/white — carries NO brand signal hue', () => {
    expect(NEUTRAL_BURST).not.toContain(BRAND.warm);
    expect(NEUTRAL_BURST).not.toContain(BRAND.purple);
    expect(NEUTRAL_BURST).not.toContain(BRAND.green);
    expect(NEUTRAL_BURST).toContain(NEUTRAL_CONFETTI.white);
  });

  it('CHAIN_CONFETTI carries the brand hues for the ConceptChain square spray', () => {
    expect(CHAIN_CONFETTI).toEqual(
      expect.arrayContaining([BRAND.warm, BRAND.purple, BRAND.green, BRAND.gold]),
    );
  });
});

describe('confetti-palette — de-arcade intent holds (no legacy arcade hues)', () => {
  it('no exported palette reintroduces a legacy arcade hue', () => {
    const everyHex = [
      ...Object.values(BRAND_CONFETTI),
      ...Object.values(NEUTRAL_CONFETTI),
      ...WARM_CONFETTI,
      ...PURPLE_CONFETTI,
      ...CELEBRATION_CONFETTI,
      ...NEUTRAL_BURST,
      ...CHAIN_CONFETTI,
    ].map((c) => c.toUpperCase());

    for (const forbidden of FORBIDDEN_ARCADE_HEX) {
      expect(everyHex).not.toContain(forbidden.toUpperCase());
    }
  });
});
