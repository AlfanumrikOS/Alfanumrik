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

/**
 * Height + horizontal padding + type size for text-entry controls
 * (Input, Select, and the single-line metrics Textarea reuses).
 * md is the default and gives a 48px touch target on mobile; sm still
 * clears the 44px WCAG minimum (design-system.md §5, §10).
 */
export const CONTROL_TEXT_SIZE: Record<ControlSize, string> = {
  sm: 'h-11 text-fluid-sm',
  md: 'h-12 text-fluid-base',
  lg: 'h-14 text-fluid-md',
};

/**
 * Shared base appearance for text-entry controls (Input / Textarea / Select).
 * Token-only: semantic surface + border + focus ring. The invalid (danger)
 * border/ring is applied conditionally by each control from its resolved
 * `aria-invalid` — never colour-only (an alert icon + message carry the state).
 */
export const CONTROL_TEXT_BASE =
  'w-full rounded-lg border border-surface-3 bg-surface-1 text-foreground ' +
  'placeholder:text-muted-foreground ' +
  'transition-colors duration-150 ease-out motion-reduce:transition-none ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 ' +
  'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:opacity-60';

/** Danger border + ring applied when a control resolves aria-invalid=true. */
export const CONTROL_INVALID =
  'border-danger focus-visible:ring-danger';

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
