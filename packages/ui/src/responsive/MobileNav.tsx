'use client';

/**
 * MobileNav — production-grade mobile bottom navigation (2026-05-19).
 *
 * Design rationale:
 *   - 5 slots max. Nielsen-Norman + Duolingo research: > 5 reduces
 *     discoverability and increases cognitive load. The 5th slot is
 *     typically a "More" sheet trigger.
 *   - 60px tall on phones, expands to (60 + safe-area-inset-bottom)
 *     on notched/gesture-bar devices via `padding-bottom`.
 *   - Center slot is the prominent Foxy AI tutor entry — the brand
 *     differentiator. Lifted 14px above the rail (-margin-top on the
 *     icon) so it reads as a primary action, not just another tab.
 *   - Active state: orange icon + underline + bold label, all CSS-only
 *     (no JS-driven indicator). Per WCAG, we never rely on color alone:
 *     the underline + bold weight + scale change carry meaning too.
 *   - Bilingual via useAuth().isHi. Labels accept labelHi prop.
 *   - ARIA: nav landmark + aria-current="page" on active + descriptive
 *     aria-label per item (icon-only items would otherwise be unreadable
 *     by screen readers).
 *   - Thumb-zone optimization: research from Steven Hoober shows the
 *     outer slots on a 5-slot nav are the easiest to reach with a right
 *     thumb (the natural "C-shape" arc). We sort traffic by intent:
 *     Home (left, default landing), Practice (left-of-center), Foxy
 *     (center FAB), Progress (right-of-center), More (rightmost).
 *   - Auto-hide on scroll-down, reveal on scroll-up. Uses passive
 *     scroll listener with rAF throttle (NOT a setTimeout — perceived
 *     smoother on cheap Android). Respects prefers-reduced-motion.
 *   - Works without JS: base CSS makes the nav sticky and visible.
 *     Auto-hide is purely a JS enhancement.
 *
 * P7 (bilingual): all 5 default items have labelHi. Override per item.
 * P10 (bundle): no external deps, ~2 kB minified+gzipped.
 * P13 (privacy): no analytics calls from here (caller decides).
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { clsx } from 'clsx';

export interface MobileNavItem {
  /** Route to push on click. */
  href: string;
  /** Icon — emoji or React node. Avoid SVGs > 1 kB; we want this lean. */
  icon: string;
  /** English label. */
  label: string;
  /** Hindi label (P7 requirement). */
  labelHi?: string;
  /** Center FAB treatment — typically Foxy. Only ONE item should set this. */
  isFab?: boolean;
  /** Numeric badge (e.g. unread count). Renders "9+" above 9. */
  badge?: number;
  /** Badge color variant. */
  badgeVariant?: 'default' | 'danger' | 'warning';
  /** Override the auto-derived aria-label. */
  ariaLabel?: string;
  /** Override the aria-label for Hindi locale. */
  ariaLabelHi?: string;
}

export interface MobileNavProps {
  /** Items to render. Capped to 5 — extras are ignored. */
  items: MobileNavItem[];
  /** When true, the nav auto-hides on scroll-down. Default true. */
  autoHide?: boolean;
  /** Force the nav to be visible regardless of scroll state. */
  forceVisible?: boolean;
  /** Called when an item is tapped, BEFORE navigation. Use for analytics. */
  onItemTap?: (item: MobileNavItem) => void;
  /** Extra class on the nav element. */
  className?: string;
}

/**
 * Match logic: the item is active if the path equals href exactly OR
 * the path is a descendant of href (e.g. /dive/123 matches /dive).
 * Root paths (/) only match on exact equality to avoid matching every
 * descendant of the entire site.
 */
function isItemActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  if (pathname === href) return true;
  return pathname.startsWith(href + '/');
}

export function MobileNav({
  items,
  autoHide = true,
  forceVisible = false,
  onItemTap,
  className,
}: MobileNavProps) {
  const { isHi } = useAuth();
  const pathname = usePathname() ?? '/';
  const router = useRouter();
  const [hidden, setHidden] = useState(false);
  const lastScrollYRef = useRef(0);
  const rafIdRef = useRef<number | null>(null);

  // Cap to 5 items max. Research-backed limit.
  const capped = items.slice(0, 5);

  // Auto-hide on scroll-down, reveal on scroll-up.
  // Uses rAF instead of setTimeout to align with the paint cycle —
  // cheaper on Snapdragon 4xx-class phones than a 100ms throttle would be.
  useEffect(() => {
    if (!autoHide || forceVisible) return;
    if (typeof window === 'undefined') return;

    // Respect reduced motion: never hide, never animate.
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;

    const onScroll = () => {
      if (rafIdRef.current != null) return;
      rafIdRef.current = window.requestAnimationFrame(() => {
        rafIdRef.current = null;
        const y = window.scrollY;
        const last = lastScrollYRef.current;
        const delta = y - last;
        // Threshold = 8px to ignore micro-scroll jitter on touchpads.
        if (Math.abs(delta) < 8) return;
        // Always show within 80px of top (no flicker on bounce).
        if (y < 80) {
          setHidden(false);
        } else if (delta > 0) {
          setHidden(true);
        } else {
          setHidden(false);
        }
        lastScrollYRef.current = y;
      });
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (rafIdRef.current != null) window.cancelAnimationFrame(rafIdRef.current);
    };
  }, [autoHide, forceVisible]);

  const handleTap = useCallback(
    (item: MobileNavItem) => {
      if (onItemTap) onItemTap(item);
      router.push(item.href);
    },
    [onItemTap, router],
  );

  return (
    <nav
      className={clsx('mobile-nav-v2', className)}
      data-hidden={hidden && !forceVisible ? 'true' : 'false'}
      role="navigation"
      aria-label={isHi ? 'मुख्य नेविगेशन' : 'Main navigation'}
    >
      {capped.map((item) => {
        const active = isItemActive(pathname, item.href);
        const labelText = isHi && item.labelHi ? item.labelHi : item.label;
        const ariaText =
          (isHi ? item.ariaLabelHi : item.ariaLabel) ??
          (isHi && item.labelHi ? item.labelHi : item.label);
        const badgeText =
          item.badge != null && item.badge > 0
            ? item.badge > 9
              ? '9+'
              : String(item.badge)
            : null;
        const badgeVariant = item.badgeVariant ?? 'default';
        const itemClass = clsx(
          'mobile-nav-v2__item',
          item.isFab && 'mobile-nav-v2__item--fab',
        );
        return (
          <button
            key={item.href}
            type="button"
            className={itemClass}
            aria-current={active ? 'page' : undefined}
            aria-label={ariaText}
            onClick={() => handleTap(item)}
          >
            <span className="mobile-nav-v2__icon" aria-hidden="true">
              {item.icon}
              {badgeText != null && (
                <span
                  className={clsx(
                    'mobile-nav-v2__badge',
                    badgeVariant === 'danger' && 'mobile-nav-v2__badge--danger',
                    badgeVariant === 'warning' && 'mobile-nav-v2__badge--warning',
                  )}
                  aria-hidden="true"
                >
                  {badgeText}
                </span>
              )}
            </span>
            <span className="mobile-nav-v2__label">{labelText}</span>
          </button>
        );
      })}
    </nav>
  );
}

/**
 * Default 5-item nav config for the student portal. Exposed so other
 * portals (parent, teacher) can compose their own configs while still
 * sharing the visual primitive.
 */
export const STUDENT_NAV_ITEMS: MobileNavItem[] = [
  { href: '/dashboard', icon: '🏠', label: 'Home',     labelHi: 'होम' },
  { href: '/quiz',      icon: '✏️', label: 'Practice', labelHi: 'अभ्यास' },
  { href: '/foxy',      icon: '🦊', label: 'Foxy',     labelHi: 'फॉक्सी', isFab: true },
  { href: '/progress',  icon: '📈', label: 'Progress', labelHi: 'प्रगति' },
  { href: '/learn',     icon: '📚', label: 'Learn',    labelHi: 'सीखें' },
];

export default MobileNav;
