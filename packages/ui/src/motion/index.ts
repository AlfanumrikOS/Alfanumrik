/**
 * Motion barrel — the framer-motion adoption surface (2026-08-09).
 *
 * Deliberately NOT re-exported from any existing barrel. Nothing in the
 * app imports this today; it exists so that the FIRST adopter gets the
 * code-split, reduced-motion-aware, feature-split path by default
 * instead of reaching for `import { motion } from 'framer-motion'`.
 *
 * Read ./README.md before using any of it — in particular the P10
 * budget rules and the student-surface conditions.
 *
 * Import cost of THIS barrel: no framer-motion in the eager chunk.
 *
 * That holds for a specific, checkable reason — NOT because of
 * tree-shaking. `packages/ui/package.json` has no `"sideEffects": false`
 * and `@alfanumrik/ui` is in `transpilePackages` (apps/host/next.config.js),
 * so webpack treats these modules as side-effectful and will pull in
 * EVERY module this barrel statically re-exports, whether or not the
 * consumer uses the binding. The guarantee therefore rests on the only
 * durable property available: **every module reachable by a static
 * re-export from here is itself framer-motion-free.**
 *
 *   - `./presets`        `import type` only ⇒ erased at build time.
 *   - `./dynamicMotion`  imports `next/dynamic` + types only; it reaches
 *                        MotionProvider through a dynamic `import()`,
 *                        which webpack emits as a separate async chunk.
 *
 * `MotionProvider` is intentionally NOT exported here — it statically
 * imports framer-motion, so re-exporting it would drag framer-motion
 * into the eager chunk of anything importing this barrel and defeat the
 * `ssr: false` island. Reach it via `createMotionIsland()`.
 *
 * Adding a static re-export of any framer-motion-importing module to
 * this file silently breaks the guarantee above. Don't.
 *
 * Follow-up (not done here, deliberately): adding `"sideEffects": false`
 * to `packages/ui/package.json` would let webpack elide unused
 * re-exports package-wide. That has implications well beyond this
 * directory (every module in `@alfanumrik/ui`, including any with import
 * side effects) and needs its own review — quality flagged it as such.
 */

export { createMotionIsland, type MotionIslandOptions } from './dynamicMotion';

export {
  fadeIn,
  slideUp,
  scaleIn,
  staggerContainer,
  DURATION,
  EASE_STANDARD,
  EASE_SPRING,
  EASE_SMOOTH,
  STAGGER_BASE_DELAY,
  STAGGER_STEP,
  STAGGER_MAX_INDEX,
} from './presets';
