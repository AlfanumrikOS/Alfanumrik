import type { Transition, Variants } from 'framer-motion';

/* ═══════════════════════════════════════════════════════════════
   Motion presets — framer-motion variants that MATCH the existing
   CSS motion identity.

   Type-only framer-motion import ⇒ fully erased at build time. This
   module costs zero runtime bytes and is safe to import from anywhere,
   including a file that is part of first paint.

   Every easing and duration below is copied from the values already
   shipping in `apps/host/tailwind.config.js` (theme.extend.animation)
   and `packages/ui/src/globals.css`, so an island animated with these
   presets is indistinguishable from the CSS-animated surfaces beside
   it. Do not invent new curves here — if a new motion is needed, add
   it to the CSS first so the two systems cannot drift.
   ═══════════════════════════════════════════════════════════════ */

/** framer's cubic-bezier tuple shape. */
type Bezier = [number, number, number, number];

/* ── Easings (mirrors of the CSS cubic-beziers in use) ── */

/** `ease-out` — used by `animate-fade-in` / `animate-slide-up`. */
export const EASE_STANDARD = 'easeOut' as const;

/** `cubic-bezier(0.34,1.56,0.64,1)` — the overshoot curve behind
 *  `animate-scale-in`, `animate-bounce-in`, `animate-level-up`,
 *  `animate-xp-burst`, `animate-score-reveal`. */
export const EASE_SPRING: Bezier = [0.34, 1.56, 0.64, 1];

/** `cubic-bezier(0.4,0,0.2,1)` — the non-overshoot fill curve behind
 *  `animate-mastery-fill`. Use for progress//meter motion, where an
 *  overshoot would render a value the student never actually earned. */
export const EASE_SMOOTH: Bezier = [0.4, 0, 0.2, 1];

/* ── Durations (seconds — framer's unit; the CSS values are ms) ── */

export const DURATION = {
  /** 0.3s — `fade-in`, `scale-in`. */
  fast: 0.3,
  /** 0.4s — `slide-up`. */
  base: 0.4,
  /** 0.5s — `bounce-in`. */
  slow: 0.5,
  /** 0.8s — `score-reveal`. */
  reveal: 0.8,
} as const;

/* ── Stagger (mirrors the `--reveal-i` ladder in globals.css) ──
   CSS: `calc(0.06s + min(var(--reveal-i,0),6) * 0.07s)`. The cap at 6
   is deliberate — beyond it the last card feels broken, not staggered.
   `staggerContainer()` reproduces the same base delay and step. */

export const STAGGER_BASE_DELAY = 0.06;
export const STAGGER_STEP = 0.07;
/** Beyond this many children the CSS ladder stops adding delay. */
export const STAGGER_MAX_INDEX = 6;

const transition = (
  duration: number,
  ease: Bezier | typeof EASE_STANDARD,
): Transition => ({ duration, ease });

/* ── Variants ──
   Each is a `hidden` → `visible` pair so islands share one vocabulary:
     <m.div variants={fadeIn} initial="hidden" animate="visible" />
   Under `prefers-reduced-motion`, MotionProvider's
   `reducedMotion="user"` drops the transform channels and keeps opacity,
   matching the CSS blanket. */

/** Opacity only. The safe default — no transform, so nothing shifts. */
export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: transition(DURATION.fast, EASE_STANDARD),
  },
};

/** Rise + fade. Mirrors `animate-slide-up`. 12px matches the CSS. */
export const slideUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: transition(DURATION.base, EASE_STANDARD),
  },
};

/** Scale + fade with overshoot. Mirrors `animate-scale-in`. */
export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: transition(DURATION.fast, EASE_SPRING),
  },
};

/**
 * Parent variant that staggers children on the same ladder the CSS
 * `--reveal-i` cards use.
 *
 * Pair with any child variant (`slideUp`, `fadeIn`, …) on the children.
 *
 * @param step   seconds between children (default: the CSS 0.07s)
 * @param delay  seconds before the first child (default: the CSS 0.06s)
 */
export const staggerContainer = (
  step: number = STAGGER_STEP,
  delay: number = STAGGER_BASE_DELAY,
): Variants => ({
  hidden: {},
  visible: {
    transition: { delayChildren: delay, staggerChildren: step },
  },
});
