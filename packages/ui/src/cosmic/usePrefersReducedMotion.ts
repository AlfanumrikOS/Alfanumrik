'use client';

import { useEffect, useState } from 'react';

/**
 * Returns true when the user has requested reduced motion at the OS level.
 *
 * CSS already disables the cosmic CSS-keyframe animations under
 * `@media (prefers-reduced-motion: reduce)` (see globals.css). This hook is
 * for the cases CSS can't reach — SVG SMIL `<animate>` elements inside the
 * cosmic Foxy mascot, which must be conditionally OMITTED, not just paused.
 *
 * SSR-safe: defaults to `false` (motion on) on the server and during the very
 * first client render, then corrects on mount. Defaulting to false keeps the
 * mascot's full identity for the majority who don't set the preference; the
 * one-frame correction for reduced-motion users is imperceptible.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    // addEventListener is supported in all 2026 target browsers; the
    // deprecated addListener fallback is kept for very old WebViews.
    if (mq.addEventListener) {
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
    mq.addListener(onChange);
    return () => mq.removeListener(onChange);
  }, []);

  return reduced;
}
