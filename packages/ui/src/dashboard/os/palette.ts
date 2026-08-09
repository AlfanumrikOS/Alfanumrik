/**
 * Student-dashboard semantic palette — ONE home for every colour the Alfa OS
 * dashboard paints.
 *
 * WHY THIS EXISTS
 * ---------------
 * Before this module, the same handful of values were re-declared in five
 * files: the `WARM_*` tint ladder existed independently in TodaysMission,
 * BoardScoreWidget, RevisionRail and StudentOSDashboard, and the `tint()`
 * colour-mix helper was copy-pasted verbatim into MasterySnapshot AND
 * BoardScoreWidget. Each copy was free to drift, and several already had:
 * three different fallback hexes were in flight for the same "mastered green".
 *
 * Every export below is a CSS custom property reference, so the surface stays
 * theme-driven. The only literal is the documented AA fallback on
 * MASTERY_STRONG (see the note on that constant).
 *
 * PAIRING RULE (WCAG AA, ≥ 4.5:1 for normal text)
 * -----------------------------------------------
 * `ACCENT_SURFACE` MUST be paired with `ON_ACCENT`. Do NOT put white on bare
 * `WARM` (#E8581C): that is 3.59:1 and fails — a trap already documented in
 * apps/host/tailwind.config.js. The gradient stops behind ACCENT_SURFACE
 * (#CB4710 → #C2440F) are the AA-verified ones.
 */

/* ── Brand warm channel ──────────────────────────────────────────────────────
   The stable warm channel declared in globals.css :root. Kept separate from
   `--orange` because the cosmic scopes remap `--orange` to violet. */
export const WARM = 'var(--accent-warm, #E8581C)';
export const WARM_STRONG = 'var(--accent-warm-strong, #C2440F)';

/** Warm tint ladder — alpha stops on the warm channel, used for card washes,
 *  hairline borders and chips. One ladder, four call sites. */
export const WARM_06 = 'rgb(var(--accent-warm-rgb) / 0.06)';
export const WARM_08 = 'rgb(var(--accent-warm-rgb) / 0.08)';
export const WARM_10 = 'rgb(var(--accent-warm-rgb) / 0.10)';
export const WARM_15 = 'rgb(var(--accent-warm-rgb) / 0.15)';
export const WARM_18 = 'rgb(var(--accent-warm-rgb) / 0.18)';
export const WARM_25 = 'rgb(var(--accent-warm-rgb) / 0.25)';

/* ── Accent CTA pairing (AA-verified) ───────────────────────────────────────
   The canonical primary-action fill + its ONLY legal foreground. Both tokens
   already exist in globals.css :root (--surface-accent / --on-surface-accent);
   the dashboard was hand-rolling `background: WARM; color: '#fff'` instead,
   which shipped 3.59:1 text. */
export const ACCENT_SURFACE = 'var(--surface-accent)';
export const ON_ACCENT = 'var(--on-surface-accent, #FFFFFF)';

/** The two gradient stops behind ACCENT_SURFACE, exposed individually for the
 *  places that must scope-override a primitive's own `--orange` /
 *  `--orange-light` pair (GlowButton). Both are contrast-checked against
 *  ON_ACCENT: #CB4710 is 4.72:1 and #C2440F is 5.09:1 with #FFFFFF. */
export const ACCENT_FROM = 'var(--btn-primary-from)';
export const ACCENT_TO = 'var(--btn-primary-to)';

/* ── Mastery / status hues ──────────────────────────────────────────────────
   Colour is never the sole carrier of meaning on this surface — every use of
   these is paired with a glyph AND a text label (WCAG 1.4.1). */

/**
 * Mastered / strong. NOT `--green`.
 *
 * `--green` resolves to #16A34A on this surface, which is 3.30:1 on the white
 * card — a WCAG AA failure for the mastered percentage and every status label
 * that used it. The saturated #15803D (5.01:1) the components already claimed
 * in their comments is declared ONLY inside the
 * `html[data-design="cosmic"][data-theme="light"]` scope, and the dashboard
 * never enters that scope (useCosmicLightSurface removes `data-design`).
 * `--green-strong` is registered in apps/host/tailwind.config.js as
 * `success-strong`; promoting it into the globals.css `:root` block is a
 * follow-up for the token owner, until then the fallback carries it.
 */
export const MASTERY_STRONG = 'var(--green-strong, #15803D)';

/** In-progress / moderate — the warm channel. */
export const MASTERY_LEARNING = WARM;

/** Needs revision / weak — the deliberate violet accent. */
export const MASTERY_REVISE = 'var(--purple, #7C3AED)';

/** Critical / destructive. */
export const STATUS_CRITICAL = 'var(--danger, #DC2626)';

/* ── Neutral surface + ink ──────────────────────────────────────────────────
   Re-exported so a card can be written without a second vocabulary. */
export const SURFACE_1 = 'var(--surface-1)';
export const SURFACE_2 = 'var(--surface-2)';
export const BORDER = 'var(--border)';
export const TEXT_1 = 'var(--text-1)';
export const TEXT_2 = 'var(--text-2)';
export const TEXT_3 = 'var(--text-3)';

/**
 * Alpha helper — mixes a token toward transparent. Works for both `var()`
 * tokens and literals, so tints stay tied to the semantic colour rather than
 * being frozen as a second hex.
 *
 * @param color any CSS colour (normally one of the tokens above)
 * @param pct   0-100 opacity percentage
 */
export function tint(color: string, pct: number): string {
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
}
