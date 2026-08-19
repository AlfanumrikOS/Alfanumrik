'use client';

/**
 * TabletNavRail — tier 2 of the ONE student navigation (768–1023px).
 *
 * NET-NEW (2026-08-09). Before this, the app had exactly two tiers: a bottom
 * bar below 1024px and a sidebar at 1024px+. Every tablet, every landscape
 * phone and every small laptop window fell into the phone tier and got a
 * bottom bar stretched across a 900px viewport.
 *
 * This renders the SAME primary slots as MobileBottomNav and
 * DesktopSidebar — resolveStudentPrimaryNav(), same order, same labels, same
 * destinations — as a fixed vertical rail on the leading edge. It changes
 * presentation only; the information architecture is identical across tiers.
 *
 * Visibility is CSS-only (`.nav-rail-tablet`, globals.css): shown between
 * 768px and 1023.98px, `display:none` outside that band. The component stays
 * mounted at every width so route transitions never re-mount navigation,
 * matching how DesktopSidebar and MobileBottomNav already behave.
 *
 * A11y contract (same as the other two tiers):
 *   - icon AND visible text label on every slot
 *   - exactly one `aria-current="page"`
 *   - every slot >= --tap-min (44px) in both axes
 *   - visible keyboard focus via the --focus-ring-* tokens
 *   - the rail is a fixed gutter, not an overlay: `.app-shell` is inset by
 *     --nav-rail-width in this band, so the rail never covers page content
 *
 * P7: every label bilingual via AuthContext.isHi.
 */

import { useEffect, useState } from 'react';
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

export function TabletNavRail() {
  const pathname = usePathname();
  const router = useRouter();
  const auth = useAuth();
  const isHi = auth?.isHi ?? false;
  const { activeRole } = auth;
  const [showMore, setShowMore] = useState(false);

  const { data: navFlags } = useFeatureFlags();
  const student = (auth as any)?.student;
  const hasUpcomingExam = useHasUpcomingExam(student?.id);
  const studentGrade = parseInt(student?.grade ?? '6', 10);
  const streakCount: number = (auth as any)?.snapshot?.current_streak ?? 0;

  const isFocusedFoxy = pathname === '/foxy' || pathname?.startsWith('/foxy');

  // Mirrors DesktopSidebar's `has-sidebar` body class: the `:has()` selector
  // that insets `.app-shell` by the rail width needs a fallback for Safari
  // < 15.4 / Firefox < 121.
  useEffect(() => {
    if (isFocusedFoxy) return;
    document.body.classList.add('has-nav-rail');
    return () => document.body.classList.remove('has-nav-rail');
  }, [isFocusedFoxy]);

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

  const activeSlotId = resolvePrimaryActiveId(pathname ?? '', slots);
  const isMoreActive =
    activeSlotId === null &&
    resolveActiveNavHref(
      pathname ?? '',
      moreItems.filter((m) => !getItemLock(m).locked).map((m) => m.href),
    ) !== null;

  if (isFocusedFoxy) return null;

  return (
    <>
      <NavMoreSheet open={showMore} onClose={() => setShowMore(false)} pathname={pathname ?? ''} />

      <nav className="nav-rail-tablet" aria-label="Main navigation">
        <button
          type="button"
          onClick={() => router.push('/dashboard')}
          aria-label={isHi ? 'डैशबोर्ड पर जाएं' : 'Go to Dashboard'}
          className="nav-rail-tablet__brand"
        >
          <span aria-hidden="true">🦊</span>
        </button>

        <div className="nav-rail-tablet__slots">
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
                  isHi ? (slot.a11yLabelHi ?? slot.labelHi) : (slot.a11yLabel ?? slot.label)
                }
                aria-current={!isOverflow && active ? 'page' : undefined}
                aria-expanded={isOverflow ? showMore : undefined}
                data-active={active ? 'true' : 'false'}
                data-slot={slot.id}
                className="nav-rail-tablet__slot"
              >
                <span className="nav-rail-tablet__icon" aria-hidden="true">
                  {active ? slot.activeIcon : slot.icon}
                  {slot.badge === 'streak' && streakCount > 0 && isStudent && (
                    <span
                      className="nav-rail-tablet__badge"
                      aria-label={`${streakCount} day streak`}
                    >
                      {streakCount}
                    </span>
                  )}
                </span>
                <span className="nav-rail-tablet__label">
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

export default TabletNavRail;
