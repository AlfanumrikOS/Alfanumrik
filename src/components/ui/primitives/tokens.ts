/**
 * Canonical primitive shared token maps (Phase 2 Batch A).
 *
 * Every value here is a reference to a CSS custom property defined in
 * globals.css / tailwind.config.js — NEVER a raw hex or rgb() literal.
 * Components reference ONLY the Tier-2 semantic roles so they stay
 * theme-immune (see docs/design/design-system.md §1, §7).
 */

/** Generic status/brand tones used by Badge, Chip, ProgressBar. */
export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'brand';

/** Interactive-surface variants shared by Button + IconButton. */
export type ActionVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

/** Control sizes shared across interactive primitives. */
export type ControlSize = 'sm' | 'md' | 'lg';

/** Tone → semantic CSS var (the fill / accent hue for that tone). */
export const TONE_VAR: Record<Tone, string> = {
  neutral: 'var(--text-3)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  info: 'var(--info)',
  brand: 'var(--primary)',
};

/**
 * Foreground to place ON a SOLID tone fill so text clears WCAG AA.
 * Light-luminance tones (warning gold, neutral) take ink; the darker
 * saturated tones take white. Warning NEVER renders gold-as-text
 * (design-system.md §2, §8 "no warning-gold-as-text").
 *
 * NOTE: the design system has no dedicated `--on-accent` / `--fg-on-primary`
 * token (flagged for Phase 2 follow-up). The CSS `white` keyword is used
 * here as the on-accent foreground — it is NOT a hex literal, and the §8
 * contrast table explicitly validates #FFFFFF on the primary CTA.
 */
export const TONE_SOLID_FG: Record<Tone, string> = {
  neutral: 'var(--text-1)',
  success: 'var(--text-1)',
  warning: 'var(--text-1)',
  info: 'var(--text-1)',
  danger: 'white',
  brand: 'white',
};
