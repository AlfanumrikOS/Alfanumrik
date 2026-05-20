'use client';

/**
 * AppShell — responsive layout primitive (2026-05-19).
 *
 * Replaces the inline-style shell sections of AtlasShell with a proper
 * CSS-Grid-based responsive shell. Tokens come from globals.css so the
 * shell scales fluidly across 320 → 1920px without binary breakpoint
 * snap.
 *
 * Slots:
 *   - header   — sticky top, compacts on scroll (height transition)
 *   - rail     — left sidebar (tablet+)
 *   - content  — main editorial column, capped to readable width
 *   - aside    — optional right rail (desktop only, can be suppressed)
 *   - nav      — bottom mobile nav (auto-hides when rail visible)
 *
 * Design rationale:
 *   - Mobile-first: starts as a single column with bottom nav. Tablet
 *     (768px+) adds the left rail and HIDES the bottom nav if the shell
 *     variant supports a rail. Desktop (1024px+) adds the right aside.
 *     Wide (1440px+) caps the content max-width and pads outward.
 *   - The sticky header compacts on scroll to recover ~12px of vertical
 *     real-estate, which on a 360x640 phone is ~2% of the viewport.
 *     CSS transition only — no JS.
 *   - One-handed mode: pulls the content into the bottom 2/3 of the
 *     screen so the top of the page sits in the thumb-comfort zone.
 *     State persisted in localStorage so the user's preference survives
 *     reload. Phone-only — disabled at tablet+.
 *   - Reading width cap: prose-cap helper limits long-form text to
 *     ~70ch, the research-backed optimum for comprehension.
 *
 * P7 (bilingual): one-handed toggle button is bilingual.
 * P10 (bundle): CSS-driven, ~1.2 kB minified.
 */

import {
  type ReactNode,
  useEffect,
  useRef,
  useState,
  useCallback,
} from 'react';
import { clsx } from 'clsx';
import { useAuth } from '@/lib/AuthContext';

export type AppShellVariant = 'mobile' | 'rail' | 'split';

export interface AppShellProps {
  /** Layout variant. 'mobile' = single col + bottom nav (default). 'rail' = rail + content. 'split' = rail + content + aside. */
  variant?: AppShellVariant;
  /** Header content — sticky, compacts on scroll. */
  header?: ReactNode;
  /** Left rail content (tablet+). */
  rail?: ReactNode;
  /** Optional right aside (desktop only). */
  aside?: ReactNode;
  /** Bottom mobile nav. Render <MobileNav /> here. */
  nav?: ReactNode;
  /** Main content. */
  children: ReactNode;
  /** Enable the one-handed mode toggle button. Phone-only. Default true. */
  oneHandToggle?: boolean;
  /** Extra class names on the shell wrapper. */
  className?: string;
  /** localStorage key for one-handed pref. Default 'alfanumrik:one-hand'. */
  oneHandKey?: string;
  /**
   * Full-bleed mode (default false). When true, the shell:
   *   - Drops the tablet+ rail-column reservation (no empty 220px gutter
   *     when variant="mobile").
   *   - Removes the 1240px max-width + auto margin cap on the content
   *     column at desktop+.
   *   - Removes the fluid side padding on the content column.
   *   - Preserves bottom padding for the fixed BottomNav clearance.
   * Intended for chat-style surfaces (Foxy) whose internal layouts manage
   * their own multi-column widths and must paint edge-to-edge. Editorial
   * surfaces (dashboard, learn) should leave this off so they keep the
   * readable 1240px cap.
   */
  bleed?: boolean;
}

const SCROLL_COMPACT_THRESHOLD = 24;

export function AppShell({
  variant = 'mobile',
  header,
  rail,
  aside,
  nav,
  children,
  oneHandToggle = true,
  oneHandKey = 'alfanumrik:one-hand',
  className,
  bleed = false,
}: AppShellProps) {
  const { isHi } = useAuth();
  const [headerCompact, setHeaderCompact] = useState(false);
  const [oneHand, setOneHand] = useState(false);
  const rafIdRef = useRef<number | null>(null);

  // Restore one-handed preference from localStorage. SSR-safe.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const stored = window.localStorage.getItem(oneHandKey);
      if (stored === 'true') setOneHand(true);
    } catch {
      /* private browsing / storage disabled — keep default */
    }
  }, [oneHandKey]);

  // Persist one-handed pref. We write on every toggle, not on unmount,
  // so a crash doesn't lose the user's choice.
  const toggleOneHand = useCallback(() => {
    setOneHand((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(oneHandKey, String(next));
      } catch {
        /* non-fatal */
      }
      return next;
    });
  }, [oneHandKey]);

  // Compact-on-scroll header. rAF-throttled like the MobileNav scroll
  // listener to keep cheap Android phones smooth.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    // We still compact under reduced-motion, but without the transition
    // (CSS already disables the transition when prefers-reduced-motion is set).
    void reduced;

    const onScroll = () => {
      if (rafIdRef.current != null) return;
      rafIdRef.current = window.requestAnimationFrame(() => {
        rafIdRef.current = null;
        const y = window.scrollY;
        setHeaderCompact(y > SCROLL_COMPACT_THRESHOLD);
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (rafIdRef.current != null) window.cancelAnimationFrame(rafIdRef.current);
    };
  }, []);

  // Variant flags
  const hasRail = variant === 'rail' || variant === 'split';
  const hasAside = variant === 'split' && !!aside;

  return (
    <div
      className={clsx('app-shell-v2', className)}
      data-variant={variant}
      data-no-aside={!hasAside ? 'true' : 'false'}
      data-one-hand={oneHand ? 'true' : 'false'}
      data-bleed={bleed ? 'true' : 'false'}
    >
      {/* Sticky header */}
      <header className="app-shell-header" data-compact={headerCompact ? 'true' : 'false'}>
        {header}
        {/* One-handed toggle pinned to the right of the header.
            Only renders on phones (CSS hides above 768px via display rule
            applied here). */}
        {oneHandToggle && (
          <button
            type="button"
            onClick={toggleOneHand}
            aria-label={
              isHi
                ? oneHand
                  ? 'सामान्य मोड पर वापस जाएँ'
                  : 'एक-हाथ मोड चालू करें'
                : oneHand
                  ? 'Disable one-handed mode'
                  : 'Enable one-handed mode'
            }
            aria-pressed={oneHand}
            className="app-shell-onehand-toggle"
          >
            {oneHand ? '⬇' : '⬆'}
          </button>
        )}
      </header>

      {/* Optional left rail — tablet+ only via CSS. */}
      {hasRail && <aside className="app-shell-rail">{rail}</aside>}

      {/* Main content — single column on mobile, two-column at tab,
          three-column at desk (when split variant requested). */}
      <main className="app-shell-content" id="main">
        {children}
      </main>

      {/* Optional right aside — desktop only via CSS. */}
      {hasAside && <aside className="app-shell-aside">{aside}</aside>}

      {/* Bottom nav — visible on mobile, hidden when rail is active. */}
      {nav && <div className="app-shell-nav">{nav}</div>}
    </div>
  );
}

export default AppShell;
