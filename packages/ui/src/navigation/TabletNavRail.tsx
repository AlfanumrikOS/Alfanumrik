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
  MORE_SHEET_GROUPS,
  NAV_GROUP_FLYOUT_KEYS,
  STUDENT_MORE_SLOT,
  type ResolvedNavSlot,
} from './nav-config';
import { NavMoreSheet, useMoreSheetItems } from './NavMoreSheet';
import { useHasUpcomingExam } from './use-has-upcoming-exam';
// Imported from the MODULE, not the '../ui/primitives' barrel, so the
// always-mounted rail does not pull the whole primitive library into the
// shared first-load chunk (P10).
import { Menu, type MenuItem } from '../ui/primitives/Menu';

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

  /* ── Grouped secondary nav (ff_nav_groups_v1) ─────────────────────────────
   *
   * TIER 2 PROJECTION. The mobile sheet renders these groups as inline
   * sections; the 1024+ sidebar renders them as disclosure sections. The rail
   * is ~72px wide, so neither fits — here they are anchored `Menu` flyouts
   * opening to the right of their trigger.
   *
   * MEMBERSHIP, LABELS AND ORDER ARE IDENTICAL to the other two tiers (IA law
   * 2 constrains the items, not the chrome) — they are read from the same
   * MORE_ITEMS rows, already flag- and exam-filtered by useMoreSheetItems().
   *
   * The flyout groups are then EXCLUDED from the More sheet this rail opens
   * (see `excludeGroupKeys` below). Without that, /pyq would be reachable from
   * both the flyout and the sheet at 800px — one destination in two places,
   * the IA-law-1 violation nav-config keeps recording.
   *
   * With the flag OFF every one of those rows is already gone, so
   * `flyoutGroups` is empty, nothing renders, and the exclusion is a no-op:
   * the rail is byte-for-byte what it was.
   */
  const groupKeyOf = (item: unknown): string | undefined =>
    (item as { group?: string } | undefined)?.group;

  const flyoutGroups = MORE_SHEET_GROUPS.filter((g) =>
    NAV_GROUP_FLYOUT_KEYS.includes(g.key),
  )
    .map((group) => ({
      key: group.key,
      icon: group.icon ?? '▸',
      label: isHi ? group.hi : group.en,
      items: moreItems
        .filter((item) => groupKeyOf(item) === group.key)
        .map(
          (item): MenuItem => ({
            id: item.href,
            href: item.href,
            icon: item.icon,
            label: item.label,
            labelHi: item.labelHi,
            // Grade-locked rows stay PRESENT but inert, so the tablet
            // membership still matches the sheet's. Their label is not
            // rewritten — one destination, one name, at every breakpoint.
            disabled: getItemLock(item).locked || undefined,
          }),
        ),
      hrefs: moreItems
        .filter((item) => groupKeyOf(item) === group.key && !getItemLock(item).locked)
        .map((item) => item.href),
    }))
    // Empty-group skip, same rule the sheet and the sidebar apply.
    .filter((group) => group.items.length > 0);

  /** Rows the OVERFLOW SHEET still owns at this tier (everything not in a flyout). */
  const sheetItems = moreItems.filter(
    (item) => !NAV_GROUP_FLYOUT_KEYS.includes(groupKeyOf(item) ?? ''),
  );

  const activeSlotId = resolvePrimaryActiveId(pathname ?? '', slots);
  const isMoreActive =
    activeSlotId === null &&
    resolveActiveNavHref(
      pathname ?? '',
      sheetItems.filter((m) => !getItemLock(m).locked).map((m) => m.href),
    ) !== null;
  /** A flyout trigger reads "active" only when no primary slot owns the route. */
  const activeGroupKey =
    activeSlotId === null
      ? (flyoutGroups.find(
          (group) => resolveActiveNavHref(pathname ?? '', group.hrefs) !== null,
        )?.key ?? null)
      : null;

  if (isFocusedFoxy) return null;

  return (
    <>
      <NavMoreSheet
        open={showMore}
        onClose={() => setShowMore(false)}
        pathname={pathname ?? ''}
        excludeGroupKeys={NAV_GROUP_FLYOUT_KEYS}
      />

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

        {/* Grouped secondary nav — a SEPARATE band below the primary slots.
            Deliberately not spliced into `.nav-rail-tablet__slots` above: the
            primary five carry `data-slot` and their order is a product
            contract asserted at this exact breakpoint (e2e/ui-nav-contract),
            so these triggers carry `data-nav-group` instead and cannot be
            mistaken for a sixth and seventh slot. They are menu buttons, not
            destinations, so — exactly like "More" — they never take
            `aria-current="page"`; `aria-expanded` is supplied by <Menu>. */}
        {flyoutGroups.length > 0 && (
          <div
            className="nav-rail-tablet__slots"
            style={{
              marginTop: 'var(--space-1)',
              paddingTop: 'var(--space-2)',
              borderTop: '1px solid var(--line)',
            }}
          >
            {flyoutGroups.map((group) => (
              <Menu
                key={group.key}
                items={group.items}
                isHi={isHi}
                label={group.label}
                // The rail hugs the leading edge, so the panel opens INTO the
                // page. usePopoverPosition flips it left if there is no room.
                placement="right-start"
                onNavigate={(href) => router.push(href)}
              >
                <button
                  type="button"
                  data-nav-group={group.key}
                  data-active={activeGroupKey === group.key ? 'true' : 'false'}
                  className="nav-rail-tablet__slot"
                >
                  <span className="nav-rail-tablet__icon" aria-hidden="true">
                    {group.icon}
                  </span>
                  <span className="nav-rail-tablet__label">{group.label}</span>
                </button>
              </Menu>
            ))}
          </div>
        )}
      </nav>
    </>
  );
}

export default TabletNavRail;
