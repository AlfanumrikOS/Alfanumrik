'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { usePrefersReducedMotion } from '@alfanumrik/ui/cosmic/usePrefersReducedMotion';
import s from './welcome-v3.module.css';

/**
 * FoxyMascot v2 — the landing-v3 character mascot, rebuilt 2026-07-17
 * (CEO-directed art upgrade).
 *
 * Artwork: a properly proportioned sitting fox drawn with smooth cubic-bezier
 * paths — rounded head wider than tall, pointed ears with dark-orange inners,
 * cream muzzle + chest patch, front paws, haunches, and a big cream-tipped
 * tail curling beside the body. Brand-orange gradient shading
 * (#F5A623 → #EF6A24 → #E8581C), thin #B8430F outline, white eye highlights,
 * brows and blush marks. Gradient ids are namespaced per instance via
 * useId() so multiple foxes on one page never collide.
 *
 * Gesture system (CSS classes in welcome-v3.module.css, all transform/opacity):
 *  - idle       breathing + slow tail sway + periodic blink + occasional ear twitch
 *  - wave       right arm arcs up, 2 oscillations (one-shot)
 *  - think      head tilt + paw toward chin + ear up (posed via transitions)
 *  - happy      squint-smile eyes + double hop (one-shot)
 *  - celebrate  both arms up + hop loop
 *  - peek       body mostly hidden below the frame, eyes visible
 *
 * Interactivity (opt-in via `interactive` — kept OFF by default so foxes
 * nested inside links, e.g. the NavV3 logo, never swallow taps or create
 * nested-interactive surprises):
 *  - hover → wave once; click/tap → celebrate for 1.5s
 *  - stays aria-hidden decorative: no tabindex, no focus steal (mousedown is
 *    prevented), no keyboard trap
 *  - optional cursor eye-follow (`followCursor`): pupils track the pointer
 *    within ±3px, rAF-throttled, fine-pointer devices only
 *
 * prefers-reduced-motion collapses everything to a still portrait: the CSS
 * media query kills all keyframes/transitions AND the component forces the
 * effective gesture to a static pose (peek keeps its position — it is
 * placement, not motion).
 *
 * Back-compat: the v1 props (`size`, `waveOnView`, `className`) keep working
 * unchanged — `waveOnView` still plays a one-time wave at >=50% visibility,
 * then the fox settles into idle.
 */

export type FoxyGesture = 'idle' | 'wave' | 'think' | 'happy' | 'celebrate' | 'peek';

export interface FoxyMascotProps {
  /** Rendered square size in px. Ignored if `className` sizes the element. */
  size?: number;
  /** Play a one-time wave when >=50% in view (then idle). */
  waveOnView?: boolean;
  className?: string;
  /** Externally driven gesture (e.g. the hero fox reacting to the chat demo). */
  gesture?: FoxyGesture;
  /** Enable hover→wave / click→celebrate. Default false (safe inside links). */
  interactive?: boolean;
  /** Subtle pupil eye-follow of the cursor (desktop fine-pointer only). */
  followCursor?: boolean;
}

const WAVE_MS = 1900; // matches the v3wave2 CSS animation (1.8s) + settle
const CELEBRATE_MS = 1500;

export default function FoxyMascot({
  size,
  waveOnView = false,
  className,
  gesture = 'idle',
  interactive = false,
  followCursor = false,
}: FoxyMascotProps) {
  const reduced = usePrefersReducedMotion();
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const svgRef = useRef<SVGSVGElement | null>(null);
  const pupilsRef = useRef<SVGGElement | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [viewWaving, setViewWaving] = useState(false);
  const [hoverWaving, setHoverWaving] = useState(false);
  const [celebrating, setCelebrating] = useState(false);

  // One-time wave on intersection (waveOnView back-compat behavior).
  useEffect(() => {
    if (!waveOnView || reduced) return;
    const el = svgRef.current;
    if (el === null || typeof IntersectionObserver === 'undefined') return;
    let done = false;
    const wave = () => {
      if (done) return;
      done = true;
      setViewWaving(true);
      timersRef.current.push(setTimeout(() => setViewWaving(false), WAVE_MS));
    };
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            obs.disconnect();
            wave();
          }
        });
      },
      { threshold: 0.5 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [waveOnView, reduced]);

  // Clear pending gesture timers on unmount.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach(clearTimeout);
      timers.length = 0;
    };
  }, []);

  // Optional pupil eye-follow — rAF-throttled, fine-pointer only, never
  // under reduced motion.
  useEffect(() => {
    if (!followCursor || reduced) return;
    if (typeof window === 'undefined' || !window.matchMedia) return;
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    // Both nodes are stable for the component's lifetime; captured here so
    // the cleanup below resets the SAME pupils node it animated.
    const pupilsEl = pupilsRef.current;
    let raf = 0;
    let px = 0;
    let py = 0;
    const apply = () => {
      raf = 0;
      const svg = svgRef.current;
      const pupils = pupilsRef.current;
      if (!svg || !pupils) return;
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0) return;
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height * 0.36; // eye line
      // ±3px max drift in viewBox units (viewBox is 120 wide).
      const scale = 120 / rect.width;
      const dx = Math.max(-3, Math.min(3, (px - cx) * scale * 0.06));
      const dy = Math.max(-3, Math.min(3, (py - cy) * scale * 0.06));
      pupils.setAttribute('transform', `translate(${dx.toFixed(2)} ${dy.toFixed(2)})`);
    };
    const onMove = (e: MouseEvent) => {
      px = e.clientX;
      py = e.clientY;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onMove);
      if (raf) cancelAnimationFrame(raf);
      pupilsEl?.removeAttribute('transform');
    };
  }, [followCursor, reduced]);

  const onEnter = () => {
    if (!interactive || reduced || celebrating || hoverWaving || viewWaving) return;
    setHoverWaving(true);
    timersRef.current.push(setTimeout(() => setHoverWaving(false), WAVE_MS));
  };

  const onTap = () => {
    if (!interactive || reduced || celebrating) return;
    setCelebrating(true);
    timersRef.current.push(setTimeout(() => setCelebrating(false), CELEBRATE_MS));
  };

  // Gesture priority: tap-celebrate > external prop > wave triggers > idle.
  // Reduced motion: still portrait (peek keeps its placement).
  const effective: FoxyGesture = reduced
    ? gesture === 'peek'
      ? 'peek'
      : 'idle'
    : celebrating
      ? 'celebrate'
      : gesture !== 'idle'
        ? gesture
        : hoverWaving || viewWaving
          ? 'wave'
          : 'idle';

  const gestureClass: Record<FoxyGesture, string | undefined> = {
    idle: undefined,
    wave: s.gWave,
    think: s.gThink,
    happy: s.gHappy,
    celebrate: s.gCelebrate,
    peek: s.gPeek,
  };

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 120 120"
      width={size}
      height={size}
      className={`${s.fx} ${gestureClass[effective] ?? ''} ${className ?? ''}`.trim()}
      data-gesture={effective}
      aria-hidden="true"
      focusable="false"
      onMouseEnter={interactive ? onEnter : undefined}
      onMouseDown={interactive ? (e) => e.preventDefault() : undefined}
      onClick={interactive ? onTap : undefined}
    >
      <defs>
        <linearGradient id={`${uid}-body`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#F5A623" />
          <stop offset="0.55" stopColor="#EF6A24" />
          <stop offset="1" stopColor="#E8581C" />
        </linearGradient>
        <linearGradient id={`${uid}-tail`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#E8581C" />
          <stop offset="0.6" stopColor="#EF6A24" />
          <stop offset="1" stopColor="#F5A623" />
        </linearGradient>
      </defs>
      <g className={s.fxAll}>
        {/* tail — big cream-tipped curl beside the body (sways) */}
        <g className={s.fxTail}>
          <path
            d="M74 98 C88 104.5 101 102 107.5 91.5 C113.5 81.5 111.5 66.5 101.5 60 C99 58.4 96 57.4 93 57.6 C98.6 63.4 100.8 71.6 98.4 79.2 C95.6 88.2 87.6 93.6 78 93.6 C76 93.6 74 93.3 72 92.7 Z"
            fill={`url(#${uid}-tail)`}
            stroke="#B8430F"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <path
            d="M101.5 60 C107.8 66.8 108.8 77 104.2 84.4 C102.4 87.3 99.9 89.6 97 91 C100 84.7 100.6 77.4 98.7 70.7 C97.6 66.9 95.7 63.4 93 60.6 C95.8 59 98.9 58.8 101.5 60 Z"
            fill="#FEF3E2"
          />
        </g>
        {/* body — seated torso + haunch shading + cream chest */}
        <g className={s.fxBody}>
          <path
            d="M58 60 C46 61 37 70 34.6 82 C32.6 92.6 38.6 102.6 49 105.4 C52 106.2 55 106.6 58 106.6 C61 106.6 64 106.2 67 105.4 C77.4 102.6 83.4 92.6 81.4 82 C79 70 70 61 58 60 Z"
            fill={`url(#${uid}-body)`}
            stroke="#B8430F"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          {/* haunch hints */}
          <path
            d="M40.5 83 C38.8 91 40.8 98.5 45.6 103.2"
            stroke="#D4520F"
            strokeWidth="1.6"
            strokeLinecap="round"
            fill="none"
            opacity="0.55"
          />
          <path
            d="M75.5 83 C77.2 91 75.2 98.5 70.4 103.2"
            stroke="#D4520F"
            strokeWidth="1.6"
            strokeLinecap="round"
            fill="none"
            opacity="0.55"
          />
          {/* cream chest patch */}
          <path
            d="M58 64 C50.4 64.8 45 71 44.2 79.4 C43.4 88 49 96 58 97.4 C67 96 72.6 88 71.8 79.4 C71 71 65.6 64.8 58 64 Z"
            fill="#FEF3E2"
          />
        </g>
        {/* front legs — capsules with cream paws (gesture arms) */}
        <g className={s.fxArmL}>
          <path
            d="M47.5 78 C45.5 85 45.5 93 47.5 99.5"
            stroke="#EF6A24"
            strokeWidth="8"
            strokeLinecap="round"
            fill="none"
          />
          <circle cx="47.5" cy="102" r="4.6" fill="#FEF3E2" stroke="#B8430F" strokeWidth="1" />
        </g>
        <g className={s.fxArmR}>
          <path
            d="M68.5 78 C70.5 85 70.5 93 68.5 99.5"
            stroke="#EF6A24"
            strokeWidth="8"
            strokeLinecap="round"
            fill="none"
          />
          <circle cx="68.5" cy="102" r="4.6" fill="#FEF3E2" stroke="#B8430F" strokeWidth="1" />
        </g>
        {/* head group (tilts for think) */}
        <g className={s.fxHead}>
          {/* ears (behind the head crown) */}
          <g className={s.fxEarL}>
            <path
              d="M31.6 34.4 C29.6 23 32.8 12 40 5.2 C46.8 9.6 51.4 17.6 52.6 26.4 C52.9 28.6 53 30.8 52.8 33 C46 29.6 38.4 30.2 31.6 34.4 Z"
              fill={`url(#${uid}-body)`}
              stroke="#B8430F"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
            <path
              d="M36 29.4 C35.4 21.8 37.6 14.4 42 9 C46 13.2 48.6 18.8 49.4 25 C49.5 26.2 49.6 27.4 49.5 28.6 C45.2 26.8 40.4 27 36 29.4 Z"
              fill="#D4520F"
            />
          </g>
          <g className={s.fxEarR}>
            <path
              d="M84.4 34.4 C86.4 23 83.2 12 76 5.2 C69.2 9.6 64.6 17.6 63.4 26.4 C63.1 28.6 63 30.8 63.2 33 C70 29.6 77.6 30.2 84.4 34.4 Z"
              fill={`url(#${uid}-body)`}
              stroke="#B8430F"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
            <path
              d="M80 29.4 C80.6 21.8 78.4 14.4 74 9 C70 13.2 67.4 18.8 66.6 25 C66.5 26.2 66.4 27.4 66.5 28.6 C70.8 26.8 75.6 27 80 29.4 Z"
              fill="#D4520F"
            />
          </g>
          {/* cheek fluff */}
          <path
            d="M30.5 44 C27.3 47.4 26.2 52.2 27.4 56.4 C30.6 54.8 33.2 52.2 34.8 49 Z"
            fill={`url(#${uid}-body)`}
          />
          <path
            d="M85.5 44 C88.7 47.4 89.8 52.2 88.6 56.4 C85.4 54.8 82.8 52.2 81.2 49 Z"
            fill={`url(#${uid}-body)`}
          />
          {/* head — rounded, wider than tall */}
          <path
            d="M58 19 C41.8 19 30.4 29.4 29.4 42.2 C28.8 50.4 33.4 57.8 41 62 C46.2 64.9 52 66.4 58 66.4 C64 66.4 69.8 64.9 75 62 C82.6 57.8 87.2 50.4 86.6 42.2 C85.6 29.4 74.2 19 58 19 Z"
            fill={`url(#${uid}-body)`}
            stroke="#B8430F"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          {/* cream muzzle */}
          <path
            d="M58 42 C52 42 45.6 44 42.4 48.4 C39.8 52 40.6 56.6 44 59.6 C47.8 62.9 52.8 64.6 58 64.6 C63.2 64.6 68.2 62.9 72 59.6 C75.4 56.6 76.2 52 73.6 48.4 C70.4 44 64 42 58 42 Z"
            fill="#FEF3E2"
          />
          {/* blush marks */}
          <ellipse cx="37.5" cy="50" rx="4" ry="2.3" fill="#E8581C" opacity="0.28" />
          <ellipse cx="78.5" cy="50" rx="4" ry="2.3" fill="#E8581C" opacity="0.28" />
          {/* eyes — round (idle) + squint-smile arcs (happy/celebrate) */}
          <g className={s.fxEyes}>
            <g ref={pupilsRef}>
              <circle cx="45.5" cy="40" r="3.7" fill="#1A1D21" />
              <circle cx="46.9" cy="38.6" r="1.3" fill="#fff" />
              <circle cx="70.5" cy="40" r="3.7" fill="#1A1D21" />
              <circle cx="71.9" cy="38.6" r="1.3" fill="#fff" />
            </g>
          </g>
          <g className={s.fxEyesHappy}>
            <path
              d="M41 41.4 C44 37.6 48.4 37.6 51.4 41.4"
              stroke="#1A1D21"
              strokeWidth="2.4"
              strokeLinecap="round"
              fill="none"
            />
            <path
              d="M64.6 41.4 C67.6 37.6 72 37.6 75 41.4"
              stroke="#1A1D21"
              strokeWidth="2.4"
              strokeLinecap="round"
              fill="none"
            />
          </g>
          {/* brows */}
          <g className={s.fxBrows}>
            <path
              d="M41 32.4 C43.4 30.6 46.4 30 49 30.8"
              stroke="#B8430F"
              strokeWidth="1.7"
              strokeLinecap="round"
              fill="none"
            />
            <path
              d="M75 32.4 C72.6 30.6 69.6 30 67 30.8"
              stroke="#B8430F"
              strokeWidth="1.7"
              strokeLinecap="round"
              fill="none"
            />
          </g>
          {/* nose + smile */}
          <path
            d="M54.6 49.4 C54.6 47.9 56.1 47 58 47 C59.9 47 61.4 47.9 61.4 49.4 C61.4 51.2 60 52.8 58 53.4 C56 52.8 54.6 51.2 54.6 49.4 Z"
            fill="#1A1D21"
          />
          <path
            d="M58 53.8 C58 56 56.6 57.4 54.6 57.8 M58 53.8 C58 56 59.4 57.4 61.4 57.8"
            stroke="#1A1D21"
            strokeWidth="1.3"
            strokeLinecap="round"
            fill="none"
          />
        </g>
      </g>
    </svg>
  );
}
