/**
 * confetti-palette.ts
 * ─────────────────────────────────────────────────────────────
 * Single source of truth for canvas-confetti / CSS-confetti brand colors.
 *
 * WHY THIS EXISTS:
 *   canvas-confetti needs literal hex arrays at call time — it cannot read
 *   CSS custom properties (`var(--accent-warm)` etc.). So every celebration
 *   surface used to hardcode its own ad-hoc array (e.g.
 *   `['#FFD700','#FFA500','#F97316','#E8581C']`), which drifted from the
 *   "Alfa Momentum" brand palette over time.
 *
 *   These constants mirror the design tokens defined in globals.css so the
 *   celebration palette stays brand-aligned across LevelUpModal,
 *   CelebrationOverlay, and ConceptChain.
 *
 * BRAND ALIGNMENT (keep in sync with globals.css :root):
 *   warm       #E8581C  → --accent-warm   (THE brand signal)
 *   warmDeep   #C2440F  → --accent-warm-strong
 *   gold       #F5A623  → --gold          (XP / coins)
 *   purple     #7C3AED  → --purple        (sharp accent)
 *   green      #16A34A  → --green         (success)
 *
 * PRESENTATION ONLY — no values, thresholds, or logic. Safe to import
 * anywhere; tree-shakes to a handful of strings (P10-safe).
 */

/** Core brand celebration hues. */
export const BRAND_CONFETTI = {
  warm: '#E8581C',
  warmDeep: '#C2440F',
  gold: '#F5A623',
  purple: '#7C3AED',
  green: '#16A34A',
} as const;

/** Tasteful neutrals for the "good" celebration tier (silver/white shimmer). */
export const NEUTRAL_CONFETTI = {
  white: '#FFFFFF',
  silver: '#C0C0C0',
  silverSoft: '#D4D4D4',
  silverDeep: '#A8A8A8',
} as const;

/**
 * Warm + gold "earned reward" burst (XP, high scores, level-up gold side).
 * Refined warm→gold ramp rather than an arcade rainbow.
 */
export const WARM_CONFETTI: string[] = [
  BRAND_CONFETTI.warm,
  BRAND_CONFETTI.warmDeep,
  BRAND_CONFETTI.gold,
  NEUTRAL_CONFETTI.white,
];

/** Purple accent burst (level-up purple side, premium accent). */
export const PURPLE_CONFETTI: string[] = [
  BRAND_CONFETTI.purple,
  '#9333EA',
  '#A855F7',
  BRAND_CONFETTI.gold,
];

/** Full celebration mix — warm + gold + purple + green (perfect-tier). */
export const CELEBRATION_CONFETTI: string[] = [
  BRAND_CONFETTI.warm,
  BRAND_CONFETTI.warmDeep,
  BRAND_CONFETTI.gold,
  BRAND_CONFETTI.purple,
  BRAND_CONFETTI.green,
];

/** Restrained silver/white burst for the "good" (not perfect) tier. */
export const NEUTRAL_BURST: string[] = [
  NEUTRAL_CONFETTI.silver,
  NEUTRAL_CONFETTI.silverDeep,
  NEUTRAL_CONFETTI.silverSoft,
  NEUTRAL_CONFETTI.white,
];

/** Square-particle palette for the ConceptChain CSS confetti. */
export const CHAIN_CONFETTI: string[] = [
  BRAND_CONFETTI.warm,
  BRAND_CONFETTI.purple,
  BRAND_CONFETTI.green,
  BRAND_CONFETTI.gold,
  '#0891B2', // teal — keeps a cool counterpoint in the square spray
];
