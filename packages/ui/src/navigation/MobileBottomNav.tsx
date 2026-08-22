'use client';

/**
 * MobileBottomNav — tier 1 of the ONE student navigation (360–767px).
 *
 * Renders the five primary slots from resolveStudentPrimaryNav() in the fixed
 * spec order: Today · Learn · Practice · Progress · More. The tablet rail
 * (TabletNavRail, 768–1023px) and the desktop sidebar (DesktopSidebar, 1024+)
 * render the SAME five, same labels, same destinations, same order — only the
 * chrome changes. Visibility per tier is CSS-only (globals.css); all three
 * components stay mounted so route transitions never re-mount navigation.
 *
 * 2026-08-09 IA CHANGE: Foxy no longer occupies the raised centre slot. It is
 * a utility (More sheet + sidebar Utilities section), and `/practice` took the
 * primary slot. See nav-config.ts for the full rationale and the
 * PRACTICE FLAG CONTRACT.
 *
 * A11y contract:
 *   - exactly one `aria-current="page"` (resolvePrimaryActiveId picks a single
 *     winner rather than each slot testing itself)
 *   - every slot is >= --tap-min (44px) in both axes, icon AND visible label
 *   - keyboard focus is visible via the --focus-ring-* tokens
 *   - safe-area padding via env(safe-area-inset-bottom)
 */

import { useState, useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { useFeatureFlags } from '@alfanumrik/lib/swr';
import {
  getCoreTabs,
  getItemLockForGrade,
  resolveActiveNavHref,
  resolvePrimaryActiveId,
  resolveStudentPrimaryNav,
  STUDENT_MORE_SLOT,
  type ResolvedNavSlot,
} from './nav-config';
import { NavMoreSheet, useMoreSheetItems } from './NavMoreSheet';
import { useHasUpcomingExam } from './use-has-upcoming-exam';

export function MobileBottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const auth = useAuth();
  const isHi = auth?.isHi ?? false;
  const { activeRole } = auth;
  const [showMore, setShowMore] = useState(false);

  const [navHidden, setNavHidden] = useState(false);
  const lastScrollYRef = useRef(0);
  const rafIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (reduced) return;
    const onScroll = () => {
      if (rafIdRef.current != null) return;
      rafIdRef.current = window.requestAnimationFrame(() => {
        rafIdRef.current = null;
        const y = window.scrollY;
        const last = lastScrollYRef.current;
        const delta = y - last;
        if (Math.abs(delta) < 8) return;
        if (y < 80) setNavHidden(false);
        else if (delta > 0) setNavHidden(true);
        else setNavHidden(false);
        lastScrollYRef.current = y;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (rafIdRef.current != null) window.cancelAnimationFrame(rafIdRef.current);
    };
  }, []);

  const { data: navFlags } = useFeatureFlags();

  const student = (auth as any)?.student;
  // Extracted to a shared hook so DesktopSidebar derives the SAME gate instead
  // of hard-coding `true` (which made "Exam Sprint" desktop-only-always).
  const hasUpcomingExam = useHasUpcomingExam(student?.id);
  const studentGrade = parseInt(student?.grade ?? '6', 10);

  // Non-student roles keep their ROLE_CONFIG-derived 4 tabs + More. Only the
  // student role has the typed five-slot primary contract.
  const isStudent = activeRole === 'student';
  const slots: ResolvedNavSlot[] = isStudent
    ? resolveStudentPrimaryNav({ flags: navFlags, grade: studentGrade, hasUpcomingExam })
    : [
        ...getCoreTabs(activeRole).map(
          (t) =>
            ({
              id: t.href as any,
              kind: 'destination' as const,
              href: t.href,
              icon: t.icon,
              activeIcon: t.activeIcon ?? t.icon,
              label: t.label,
              labelHi: t.labelHi,
              altHrefs: [],
            }) as ResolvedNavSlot,
        ),
        STUDENT_MORE_SLOT,
      ];

  const moreItems = useMoreSheetItems();
  const getItemLock = (item: any) => getItemLockForGrade(item, studentGrade);

  const streakCount: number = (auth as any)?.snapshot?.current_streak ?? 0;

  // Exactly ONE winner across the whole bar — never two aria-current="page".
  const activeSlotId = resolvePrimaryActiveId(pathname ?? '', slots);
  const isMoreActive =
    activeSlotId === null &&
    resolveActiveNavHref(
      pathname ?? '',
      moreItems.filter((m) => !getItemLock(m).locked).map((m) => m.href),
    ) !== null;

  return (
    <>
      <NavMoreSheet open={showMore} onClose={() => setShowMore(false)} pathname={pathname ?? ''} />

      <nav
        className="bottom-nav-mobile fixed bottom-0 left-0 right-0 z-50"
        aria-label="Main navigation"
        data-scroll-hidden={navHidden ? 'true' : 'false'}
        style={{
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        <div className="flex items-stretch justify-around px-1 pt-1.5 pb-1">
          {slots.map((slot) => {
            const isOverflow = slot.kind === 'overflow';
            const active = isOverflow ? isMoreActive : activeSlotId === slot.id;

            return (
              <button
                key={slot.id}
                type="button"
                onClick={
                  isOverflow
                    ? () => setShowMore((prev) => !prev)
                    : () => slot.href && router.push(slot.href)
                }
                aria-label={
                  isHi
                    ? (slot.a11yLabelHi ?? slot.labelHi)
                    : (slot.a11yLabel ?? slot.label)
                }
                aria-current={!isOverflow && active ? 'page' : undefined}
                aria-expanded={isOverflow ? showMore : undefined}
                data-active={active ? 'true' : 'false'}
                data-slot={slot.id}
                className="bottom-nav-mobile__slot"
                style={{ color: active ? 'var(--accent)' : 'var(--ink-3)' }}
              >
                <span
                  className="bottom-nav-mobile__icon"
                  style={{
                    transform: active ? 'translateY(-1px) scale(1.06)' : 'scale(1)',
                    filter: active ? 'drop-shadow(0 0 6px rgb(var(--orange-rgb) / 0.3))' : 'none',
                  }}
                  aria-hidden="true"
                >
                  {active ? slot.activeIcon : slot.icon}
                  {slot.badge === 'streak' && streakCount > 0 && isStudent && (
                    <span
                      className="bottom-nav-mobile__badge"
                      aria-label={`${streakCount} day streak`}
                    >
                      {streakCount}
                    </span>
                  )}
                </span>
                <span
                  className="bottom-nav-mobile__label"
                  style={{ fontWeight: active ? 700 : 600 }}
                >
                  {isHi ? slot.labelHi : slot.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}
