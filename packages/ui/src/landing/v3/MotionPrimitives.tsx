'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { usePrefersReducedMotion } from '@alfanumrik/ui/cosmic/usePrefersReducedMotion';
import s from './welcome-v3.module.css';

/**
 * MotionPrimitives — the landing-v3 "intelligence made visible" toolkit
 * (2026-07-17 CEO directive: ML motion identity across the landing pages).
 *
 *  - useInViewOnce  reveal-once visibility hook. Lesson from the hero chat
 *    demo bug baked in: IO alone is not enough — we ALSO rect-check at mount
 *    (element already in view at hydration) and treat missing IO as visible,
 *    so content can never be trapped in its hidden state.
 *  - CountUp        spring-ish number count-up on reveal. SSR/no-JS renders
 *    the FINAL value (never a hole); reduced-motion never animates.
 *  - MasteryRing    self-drawing progress ring (stroke-dashoffset transition
 *    on reveal). Decorative — pair it with a visible % text.
 *  - ThinkingGlyph  the shared 3-node neural eyebrow motif used on /welcome,
 *    /pricing and the marketing pages (via PageHeroV3). One consistent
 *    inline SVG, subtle staggered pulse, static under reduced motion.
 *
 * P7: these primitives render numerals/shapes only — all adjacent copy is
 * translated by the calling section.
 */

/** True once `ref` has been >= partially visible (fires exactly once). */
export function useInViewOnce<T extends Element>(
  ref: RefObject<T | null>,
  threshold = 0.3,
): boolean {
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (inView) return;
    const el = ref.current;
    if (el === null || typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    // Already visible at mount — IO can report late (or, in some scroll
    // containers, never with the expected threshold). Same failsafe family
    // as the hero chat demo fix.
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    const rect = el.getBoundingClientRect();
    if (rect.height > 0 && rect.top < vh && rect.bottom > 0) {
      setInView(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            obs.disconnect();
            setInView(true);
          }
        });
      },
      { threshold },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [inView, threshold, ref]);

  return inView;
}

export interface CountUpProps {
  /** Final value the number settles on. */
  to: number;
  durationMs?: number;
  /** Formatter, e.g. n => n.toLocaleString('en-IN'). Default String(n). */
  format?: (n: number) => string;
  /** Literal appended after the number, e.g. "%", "+". */
  suffix?: string;
  className?: string;
}

/**
 * Count-up on reveal. Renders the FINAL value on the server and whenever
 * motion is unavailable/reduced; animates 0 → `to` with an ease-out spring
 * feel once scrolled into view.
 */
export function CountUp({ to, durationMs = 1400, format, suffix = '', className }: CountUpProps) {
  const reduced = usePrefersReducedMotion();
  const ref = useRef<HTMLSpanElement | null>(null);
  const inView = useInViewOnce(ref, 0.4);
  const [display, setDisplay] = useState(to);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!inView || startedRef.current) return;
    startedRef.current = true;
    if (reduced || typeof requestAnimationFrame === 'undefined') {
      setDisplay(to);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / durationMs);
      // ease-out cubic — fast start, springy settle.
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(to * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    setDisplay(0);
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      // Reopen the guard: a cancelled count must be able to restart (React
      // StrictMode dev remounts / `to` changes) or it would freeze mid-count.
      startedRef.current = false;
    };
  }, [inView, reduced, to, durationMs]);

  return (
    <span ref={ref} className={className}>
      {(format ? format(display) : String(display)) + suffix}
    </span>
  );
}

export interface MasteryRingProps {
  /** 0–100. */
  value: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

/**
 * Self-drawing mastery ring — the arc draws from 0 to `value`% when it
 * scrolls into view (stroke-dashoffset transition; instant under reduced
 * motion via the CSS module). Decorative (aria-hidden).
 */
export function MasteryRing({ value, size = 56, strokeWidth = 6, className }: MasteryRingProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const inView = useInViewOnce(svgRef, 0.4);
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, value));
  const offset = inView ? c * (1 - clamped / 100) : c;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      className={`${s.ring} ${className ?? ''}`.trim()}
      aria-hidden="true"
      focusable="false"
    >
      <circle className={s.ringTrack} cx={size / 2} cy={size / 2} r={r} strokeWidth={strokeWidth} />
      <circle
        className={s.ringValue}
        cx={size / 2}
        cy={size / 2}
        r={r}
        strokeWidth={strokeWidth}
        strokeDasharray={c}
        strokeDashoffset={offset}
      />
    </svg>
  );
}

/**
 * ThinkingGlyph — 3-node neural motif for section eyebrows. Inherits
 * currentColor (the eyebrow orange). Decorative only.
 */
export function ThinkingGlyph() {
  return (
    <svg className={s.glyph} viewBox="0 0 20 14" aria-hidden="true" focusable="false">
      <line x1="3.5" y1="10.5" x2="10" y2="3.5" />
      <line x1="10" y1="3.5" x2="16.5" y2="10.5" />
      <line x1="3.5" y1="10.5" x2="16.5" y2="10.5" />
      <circle cx="3.5" cy="10.5" r="2.1" />
      <circle cx="10" cy="3.5" r="2.1" />
      <circle cx="16.5" cy="10.5" r="2.1" />
    </svg>
  );
}
