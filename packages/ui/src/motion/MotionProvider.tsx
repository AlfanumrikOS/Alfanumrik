'use client';

import { LazyMotion, MotionConfig, domAnimation } from 'framer-motion';
import type { ReactNode } from 'react';

/* ═══════════════════════════════════════════════════════════════
   MotionProvider — the ONLY sanctioned framer-motion entry point.

   ⚠️  DO NOT import this from a page, a layout, or any component that
   is part of first paint. It pulls framer-motion into whatever chunk
   imports it — that is why `./index.ts` does NOT re-export it. The
   supported way to reach it is `createMotionIsland()` (see
   ./dynamicMotion.tsx), which loads this module and the animated
   component together in ONE lazy, ssr:false chunk via a dynamic
   `import()`.

   Two deliberate hardenings:

   1. `LazyMotion features={domAnimation}` — feature-splitting. Loads
      only the DOM animation + gesture feature bundle instead of the
      full `motion` export, which is a materially smaller client payload
      (P10). The exact saving is version- and build-dependent, so no kB
      figure is asserted here: measure it on your adopting page with
      `node scripts/check-bundle-size.mjs` and record the delta in the
      PR.

   2. `strict` — makes `motion.div` THROW at runtime. Only the lazy
      `m.div` proxy is allowed. Without this, one stray `motion.*`
      import silently re-inflates the bundle to the full feature set and
      the feature-split above becomes decorative. Keep `strict` on.

   `reducedMotion="user"` makes framer honour the OS
   `prefers-reduced-motion` setting for transform/layout animations,
   mirroring the CSS blanket in globals.css (:772-788). Looping
   animations still need explicit handling by the author — a preference
   is not a substitute for not shipping an infinite spinner.

   P7: renders no user-facing copy. All text is the caller's `children`.
   ═══════════════════════════════════════════════════════════════ */

export interface MotionProviderProps {
  children: ReactNode;
  /**
   * How to treat the OS reduced-motion preference.
   * - `'user'`   (default) honour the OS setting — the house default.
   * - `'always'` force-reduce, for a surface known to be motion-heavy.
   * - `'never'`  ignore the preference. Requires an accessibility
   *   justification; do not reach for this to "make the demo look good".
   */
  reducedMotion?: 'user' | 'always' | 'never';
}

export function MotionProvider({
  children,
  reducedMotion = 'user',
}: MotionProviderProps) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion={reducedMotion}>{children}</MotionConfig>
    </LazyMotion>
  );
}
