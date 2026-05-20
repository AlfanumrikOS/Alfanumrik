'use client';

/**
 * HeroSplinePanel — interactive 3D Foxy card that mounts BELOW the editorial
 * hero copy on /welcome (the rendered v2 landing).
 *
 * Rendered path: /welcome → WelcomeV2 → HeroV2 → HeroSplinePanel.
 * v1 (page-v1.tsx) is NOT affected by this file.
 *
 * Performance contract (the Spline runtime is ~250 kB gzipped — P10-sensitive):
 *   1. The whole Spline iframe is gated behind an IntersectionObserver, so the
 *      runtime import (and the 2-5 MB scene download) only fires once the card
 *      is within 200px of the viewport. Above-the-fold visitors who never
 *      scroll never pay for it.
 *   2. The wrapper component itself is `next/dynamic`-imported by HeroV2 with
 *      `ssr: false`, so the Spline runtime never lands in the landing's
 *      initial chunk.
 *   3. Connection-aware fallback: `navigator.connection.effectiveType` in
 *      {`slow-2g`, `2g`} or `navigator.connection.saveData === true` renders a
 *      static cream-on-ink card instead of mounting Spline at all. Wrapped in
 *      try/catch — Safari and Firefox don't ship the Network Information API.
 *   4. Mobile (<768px) renders the static fallback regardless of connection.
 *      The robot is decorative; the editorial hero text already carries the
 *      message and the runtime is too heavy for Indian-4G phones.
 *   5. Stable height (min-h-[500px]) prevents Cumulative Layout Shift when
 *      Spline mounts after intersection.
 *
 * A11y:
 *   - The 3D scene itself is `aria-hidden="true"` (purely decorative).
 *   - Card heading is an `<h2>` (the editorial hero owns the `<h1>`).
 *   - All copy is bilingual via the useWelcomeV2 `t()` helper (P7).
 */

import { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Spotlight } from '@/components/ui/spotlight';
import { SplineScene } from '@/components/ui/splite';
import { useWelcomeV2 } from './WelcomeV2Context';

// Spline scene URL — Foxy stand-in robot (matches the design demo, runs as the
// "AI tutor" visual for the landing). If this URL ever changes, also update
// src/components/ui/spline-demo.tsx so the static reference stays in sync.
const SPLINE_SCENE_URL =
  'https://prod.spline.design/kZDDjO5HuC9GJUM2/scene.splinecode';

/**
 * Returns true on viewports < 768px. Renders once on mount + listens to
 * matchMedia for changes. SSR-safe — defaults to true (mobile-first) so the
 * static fallback shows during hydration on small screens, then re-renders
 * once the viewport is measured.
 */
function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(true);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(max-width: 767px)');
    setIsMobile(mql.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    if (mql.addEventListener) mql.addEventListener('change', handler);
    else mql.addListener(handler); // legacy Safari
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', handler);
      else mql.removeListener(handler);
    };
  }, []);
  return isMobile;
}

/**
 * Returns true if the browser reports a slow connection or data-saver mode.
 * Wrapped in try/catch because the Network Information API isn't a standard
 * (Safari + Firefox don't ship it). Defaults to false (assume fast) so we
 * don't gate Spline off for everyone in browsers without the API.
 */
function useSlowConnection(): boolean {
  const [isSlow, setIsSlow] = useState(false);
  useEffect(() => {
    try {
      const nav = navigator as Navigator & {
        connection?: {
          effectiveType?: string;
          saveData?: boolean;
          addEventListener?: (type: string, l: () => void) => void;
          removeEventListener?: (type: string, l: () => void) => void;
        };
      };
      const conn = nav.connection;
      if (!conn) return;
      const evaluate = () => {
        const et = conn.effectiveType;
        setIsSlow(conn.saveData === true || et === '2g' || et === 'slow-2g');
      };
      evaluate();
      conn.addEventListener?.('change', evaluate);
      return () => conn.removeEventListener?.('change', evaluate);
    } catch {
      // Network Information API not supported — assume connection is fine.
    }
  }, []);
  return isSlow;
}

/**
 * Mounts the Spline scene only when the host element scrolls within 200px of
 * the viewport. Avoids paying the runtime cost for visitors who never reach
 * this section of the landing.
 *
 * Uses a callback ref (not RefObject) to sidestep the React-18 LegacyRef
 * typing mismatch and to start observing the moment the DOM node attaches —
 * no second-render setRef pattern needed.
 */
function useInViewportOnce(rootMargin = '200px'): {
  setRef: (node: HTMLDivElement | null) => void;
  inView: boolean;
} {
  const [inView, setInView] = useState(false);
  const [node, setNode] = useState<HTMLDivElement | null>(null);

  const setRef = useCallback((next: HTMLDivElement | null) => {
    setNode(next);
  }, []);

  useEffect(() => {
    if (inView) return; // already triggered, do nothing
    if (!node) return;
    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) {
      // No IO support → load immediately (legacy fallback path).
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            observer.disconnect();
            break;
          }
        }
      },
      { rootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [inView, node, rootMargin]);

  return { setRef, inView };
}

/**
 * Static fallback rendered on mobile, slow connections, or before the card
 * scrolls into view. Uses the brand palette (warm ink + saffron + cream) so
 * the empty state still looks intentional rather than half-loaded.
 */
function SplineFallback({ label }: { label: string }) {
  return (
    <div
      className="flex h-full w-full items-center justify-center"
      aria-hidden="true"
    >
      <div className="flex flex-col items-center gap-3 text-center">
        {/* Foxy glyph — mirrors the SVG used inside the phone mockup
            in HeroV2.tsx so the visual identity stays consistent. */}
        <svg
          width="64"
          height="64"
          viewBox="0 0 32 32"
          aria-hidden="true"
          className="drop-shadow-[0_0_24px_rgba(232,88,28,0.45)]"
        >
          <path d="M6 8 L10 4 L12 10 Z" fill="#E8581C" />
          <path d="M26 8 L22 4 L20 10 Z" fill="#E8581C" />
          <path d="M8 6 L11 4.5 L11.5 7.5 Z" fill="#0E0B07" />
          <path d="M24 6 L21 4.5 L20.5 7.5 Z" fill="#0E0B07" />
          <ellipse cx="16" cy="18" rx="11" ry="9" fill="#E8581C" />
          <ellipse cx="16" cy="22" rx="6" ry="5" fill="#F4ECDB" />
          <circle cx="12" cy="17" r="1.6" fill="#0E0B07" />
          <circle cx="20" cy="17" r="1.6" fill="#0E0B07" />
          <ellipse cx="16" cy="20.5" rx="1.2" ry=".8" fill="#0E0B07" />
        </svg>
        <span className="text-xs uppercase tracking-[0.16em] text-[rgba(244,236,219,0.62)]">
          {label}
        </span>
      </div>
    </div>
  );
}

export default function HeroSplinePanel() {
  const { isHi, t } = useWelcomeV2();
  const isMobile = useIsMobile();
  const slow = useSlowConnection();
  const { setRef, inView } = useInViewportOnce('200px');

  // Decide whether to actually mount the Spline runtime. Three conditions
  // suppress it: small viewport, slow network, or not-yet-intersecting.
  // The card itself still renders (stable height, brand panel, spotlight,
  // headline copy) so the user sees a complete, polished surface either way.
  const mountSpline = !isMobile && !slow && inView;

  // Fallback label varies by reason so QA can spot the active path in the DOM.
  const fallbackLabel = isMobile
    ? t('Foxy · your AI tutor', 'फ़ॉक्सी · आपका AI शिक्षक')
    : slow
      ? t('Data-saver mode', 'डेटा-सेवर मोड')
      : t('Loading 3D scene', '3D दृश्य लोड हो रहा है');

  return (
    <div
      ref={setRef}
      className="mt-16 md:mt-24"
      data-testid="hero-spline-panel"
      data-spline-mounted={mountSpline ? 'true' : 'false'}
    >
      {/*
        bg-[#1a160f] = the welcome-v2 `--ink-deep` token (warm not pure black),
        so the dark panel feels like part of the same paper-and-ink aesthetic
        rather than a stranger imported from a different design system.
      */}
      <Card
        className="relative w-full overflow-hidden rounded-2xl border-0 bg-[#1a160f] min-h-[500px] md:min-h-[520px]"
        aria-labelledby="hero-spline-headline"
      >
        <Spotlight
          className="-top-40 left-0 md:left-60 md:-top-20"
          fill="#E8581C"
        />

        <div className="relative z-10 flex h-full min-h-[500px] md:min-h-[520px] flex-col md:flex-row">
          {/* Left half (or top on mobile) — brand statement */}
          <div className="flex flex-1 flex-col justify-center p-8 md:p-12 lg:p-14">
            <span className="mb-4 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[rgba(244,236,219,0.62)]">
              <span
                className="block h-1.5 w-1.5 rounded-full bg-[#E8581C]"
                aria-hidden="true"
              />
              {t('Meet Foxy in 3D', '3D में फ़ॉक्सी से मिलिये')}
            </span>

            <h2
              id="hero-spline-headline"
              className="bg-gradient-to-b from-[#F4ECDB] to-[#E8581C]/70 bg-clip-text text-3xl font-bold leading-[1.05] tracking-tight text-transparent md:text-4xl lg:text-5xl"
              style={{ fontFamily: 'var(--font-newsreader, Georgia, serif)' }}
            >
              {isHi ? (
                <>
                  फ़ॉक्सी,
                  <br />
                  <em className="not-italic text-[#E8581C]">
                    तीन आयामों में।
                  </em>
                </>
              ) : (
                <>
                  Foxy,
                  <br />
                  <em className="not-italic text-[#E8581C]">
                    in three dimensions.
                  </em>
                </>
              )}
            </h2>

            <p className="mt-5 max-w-md text-sm leading-relaxed text-[rgba(244,236,219,0.78)] md:text-base">
              {t(
                "Drag, spin, lean in. The same patient tutor that walks your child through photosynthesis and quadratics — now rendered as a little robot you can actually meet before you sign up.",
                'पकड़िए, घुमाइए, झुकिए। वही धैर्यवान शिक्षक जो आपके बच्चे को प्रकाश-संश्लेषण और द्विघात समीकरण समझाता है — अब एक छोटे रोबोट के रूप में, जिसे आप साइन-अप से पहले मिल सकते हैं।',
              )}
            </p>

            <p className="mt-3 max-w-md text-xs italic text-[rgba(244,236,219,0.55)]">
              {t(
                'Tap the scene to interact. The robot is decorative; the tutor inside is real.',
                'दृश्य पर टैप कीजिये। रोबोट सजावटी है; भीतर का शिक्षक असली है।',
              )}
            </p>
          </div>

          {/* Right half (or bottom on mobile) — the 3D scene or fallback */}
          <div
            className="relative flex-1 min-h-[280px] md:min-h-[500px]"
            aria-hidden="true"
          >
            {mountSpline ? (
              <SplineScene
                scene={SPLINE_SCENE_URL}
                className="h-full w-full"
              />
            ) : (
              <SplineFallback label={fallbackLabel} />
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
