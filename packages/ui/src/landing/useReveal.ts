'use client';

import { useEffect, useRef } from 'react';

/**
 * Alfa Momentum Wave 1 — scroll-reveal hook.
 *
 * Mirrors the IntersectionObserver pattern already used in StatsV2: attach the
 * returned ref to a container, mark descendants with `data-reveal` (and the
 * CSS-module `revealUp` class), and they fade/translate in once when they enter
 * the viewport. The observer adds the GLOBAL class `is-revealed` (matched in
 * welcome-v2.module.css via `.revealUp:global(.is-revealed)`), then unobserves
 * so it only fires once.
 *
 * Motion is fully CSS-first; this hook only toggles a class. The reduced-motion
 * collapse lives in the stylesheet, so users with `prefers-reduced-motion`
 * still see content immediately even though the class is added.
 *
 * Stagger: pass an optional per-child delay (ms). The hook writes it to the
 * `--reveal-delay` custom property the CSS transition-delay reads.
 */
export function useReveal(staggerMs = 90) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    const targets = Array.from(
      root.querySelectorAll<HTMLElement>('[data-reveal]'),
    );
    if (targets.length === 0) return;

    // SSR/no-IO fallback: reveal immediately so content is never trapped hidden.
    if (typeof IntersectionObserver === 'undefined') {
      targets.forEach((el) => el.classList.add('is-revealed'));
      return;
    }

    targets.forEach((el, i) => {
      el.style.setProperty('--reveal-delay', `${i * staggerMs}ms`);
    });

    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-revealed');
            obs.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    );

    targets.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [staggerMs]);

  return ref;
}
