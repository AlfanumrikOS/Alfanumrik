'use client';

import { useEffect, useRef, useState } from 'react';
import { usePrefersReducedMotion } from '@alfanumrik/ui/cosmic/usePrefersReducedMotion';
import s from './welcome-v3.module.css';

/**
 * FoxyMascot — the animated landing-v3 mascot.
 *
 * Geometry note: the existing `landing/FoxyMark.tsx` classic variant is a
 * DOM/CSS mascot (circular gradient base + ear/eye/nose divs) with no tail or
 * limbs, so it physically cannot carry the tail-sway / wave behaviors the
 * CEO-approved preview specifies. This component therefore renders the flat
 * SVG from `design-previews/welcome-ultra.html`, which is itself annotated
 * "geometry per FoxyMark" — same identity palette (saffron #F5A623 body,
 * deep-saffron #D4520F ear inners, cream #FEF3E2 muzzle, ink #1A1D21 eyes).
 *
 * Behaviors (all CSS keyframes in welcome-v3.module.css):
 *  - idle blink (eyes, 6s loop) + tail sway (4.5s alternate) — always on
 *  - one-time arm wave when scrolled into view (>= 50% visible), only when
 *    `waveOnView` is set; otherwise a resting front paw is drawn instead
 *  - prefers-reduced-motion collapses every animation to a still portrait
 *    (CSS media query) and skips the wave trigger entirely.
 *
 * Decorative: always `aria-hidden` — never conveys information by itself.
 */
export interface FoxyMascotProps {
  /** Rendered square size in px. Ignored if `className` sizes the element. */
  size?: number;
  /** Draw the wave arm and play a one-time wave when >=50% in view. */
  waveOnView?: boolean;
  className?: string;
}

export default function FoxyMascot({ size, waveOnView = false, className }: FoxyMascotProps) {
  const reduced = usePrefersReducedMotion();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [waving, setWaving] = useState(false);

  useEffect(() => {
    if (!waveOnView || reduced || waving) return;
    const el = svgRef.current;
    if (el === null) return;
    if (typeof IntersectionObserver === 'undefined') return; // no-IO: stay resting
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setWaving(true);
            obs.disconnect();
          }
        });
      },
      { threshold: 0.5 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [waveOnView, reduced, waving]);

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 120 120"
      width={size}
      height={size}
      className={`${waving ? s.isWaving : ''} ${className ?? ''}`.trim() || undefined}
      aria-hidden="true"
      focusable="false"
    >
      {/* tail (sways) */}
      <g className={s.fxTail}>
        <path d="M78 94 Q106 98 110 74 Q112 58 96 58 Q104 70 93 79 Q85 86 74 86 Z" fill="#F5A623" />
        <path d="M110 74 Q112 58 96 58 Q103 67 95 76 Z" fill="#FEF3E2" />
      </g>
      {/* sitting body + belly */}
      <ellipse cx="58" cy="90" rx="26" ry="21" fill="#F5A623" />
      <ellipse cx="58" cy="96" rx="13" ry="13" fill="#FEF3E2" />
      {/* ears */}
      <path d="M32 36 L42 8 L56 26 Z" fill="#F5A623" />
      <path d="M84 36 L74 8 L60 26 Z" fill="#F5A623" />
      <path d="M37 31 L43 14 L52 25 Z" fill="#D4520F" />
      <path d="M79 31 L73 14 L64 25 Z" fill="#D4520F" />
      {/* head */}
      <path d="M28 36 Q58 18 88 36 Q92 58 58 74 Q24 58 28 36 Z" fill="#F5A623" />
      {/* cream muzzle */}
      <path d="M44 52 Q58 45 72 52 Q70 66 58 71 Q46 66 44 52 Z" fill="#FEF3E2" />
      {/* ink eyes (blink) */}
      <g className={s.fxEyes}>
        <circle cx="46" cy="46" r="3.4" fill="#1A1D21" />
        <circle cx="70" cy="46" r="3.4" fill="#1A1D21" />
      </g>
      {/* nose */}
      <path d="M54 56 L62 56 L58 61 Z" fill="#1A1D21" />
      {waveOnView ? (
        /* raised waving arm (final-CTA variant) */
        <g className={s.fxArm}>
          <path
            d="M80 80 Q94 74 98 62"
            stroke="#F5A623"
            strokeWidth="9"
            strokeLinecap="round"
            fill="none"
          />
          <circle cx="99" cy="60" r="6" fill="#FEF3E2" />
        </g>
      ) : (
        /* resting front paw (default mark) */
        <ellipse cx="46" cy="106" rx="7" ry="4.5" fill="#FEF3E2" />
      )}
    </svg>
  );
}
