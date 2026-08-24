'use client';

/**
 * NavMoreSheet — the shared overflow sheet behind the fifth primary slot.
 *
 * EXTRACTED (2026-08-09) verbatim from MobileBottomNav so the new tablet
 * navigation rail (768–1023px) opens the SAME sheet instead of the codebase
 * growing yet another parallel nav component. Markup, class names, group
 * ordering, role switching, upgrade pill and the `role="dialog"` /
 * `aria-label="More navigation options"` contract are unchanged — this is a
 * move, not a redesign, so the existing regression tests that query the sheet
 * keep passing.
 *
 * Rendered only while `open` is true, so mounting it from BOTH the bottom bar
 * and the rail (only one of which is interactive at any breakpoint) can never
 * put two dialogs in the DOM at once.
 *
 * P7: every label is bilingual via AuthContext.isHi.
 */

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { ROLE_CONFIG } from '@alfanumrik/lib/constants';
import { useFeatureFlags } from '@alfanumrik/lib/swr';
import {
  getMoreItems,
  getItemLockForGrade,
  isItemVisibleForFlags,
  isNavItemActive,
  MORE_SHEET_GROUPS,
  type NavFlagGatedItem,
} from './nav-config';
import { useHasUpcomingExam } from './use-has-upcoming-exam';

export interface NavMoreSheetProps {
  open: boolean;
  onClose: () => void;
  /** Current pathname, used only for the active dot. */
  pathname: string;
  /**
   * Group keys this projection must NOT render, because the surface that
   * opened the sheet already surfaces them some other way. Only the TABLET
   * rail passes this (it renders the grouped rows as anchored `Menu`
   * flyouts): a row reachable from BOTH the flyout and the sheet at the same
   * breakpoint is one destination in two places, which the IA law forbids.
   *
   * Default `[]` — the mobile projection renders every group inline, exactly
   * as it did before, so this prop is a no-op for MobileBottomNav.
   */
  excludeGroupKeys?: readonly string[];
}

export function useMoreSheetItems() {
  const auth = useAuth();
  const { activeRole } = auth;
  const { data: navFlags } = useFeatureFlags();
  const student = (auth as any)?.student;
  const hasUpcomingExam = useHasUpcomingExam(student?.id);

  const passesExamGate = (item: any): boolean =>
    !(item?.requiresUpcomingExam === true && !hasUpcomingExam);

  return getMoreItems(activeRole)
    .filter((item) => isItemVisibleForFlags(item as NavFlagGatedItem, navFlags))
    .filter(passesExamGate);
}

export function NavMoreSheet({
  open,
  onClose,
  pathname,
  excludeGroupKeys = [],
}: NavMoreSheetProps) {
  const router = useRouter();
  const auth = useAuth();
  const isHi = auth?.isHi ?? false;
  const { roles, activeRole, setActiveRole } = auth;
  const moreSheetRef = useRef<HTMLDivElement>(null);

  const student = (auth as any)?.student;
  const studentGrade = parseInt(student?.grade ?? '6', 10);
  const getItemLock = (item: any) => getItemLockForGrade(item, studentGrade);
  const subscriptionPlan = (student?.subscription_plan as string | null | undefined) ?? null;
  const showUpgradePill =
    activeRole === 'student' && (subscriptionPlan === null || subscriptionPlan === 'free');

  const moreItems = useMoreSheetItems();

  useEffect(() => {
    if (open && moreSheetRef.current) {
      const firstButton = moreSheetRef.current.querySelector('button');
      firstButton?.focus();
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const groupOf = (item: (typeof moreItems)[number]): string | undefined =>
    (item as { group?: string } | undefined)?.group;

  const groupedMoreItems: { header?: { en: string; hi: string }; items: typeof moreItems }[] = [];
  const ungrouped = moreItems.filter((item) => !groupOf(item));
  if (ungrouped.length) groupedMoreItems.push({ items: ungrouped });
  for (const group of MORE_SHEET_GROUPS) {
    // Surfaces that project a group some other way (the tablet rail's anchored
    // flyouts) opt it out here so the same route is never reachable twice at
    // one breakpoint.
    if (excludeGroupKeys.includes(group.key)) continue;
    const items = moreItems.filter((item) => groupOf(item) === group.key);
    // EMPTY-GROUP SKIP — load-bearing for the ff_nav_groups_v1 rollout. With
    // the flag OFF every row in the "practice"/"explore" groups is filtered
    // out upstream by isItemVisibleForFlags(), so `items` is empty and the
    // header never renders. A flag-gated group therefore costs the sheet
    // nothing until it ramps.
    if (items.length) groupedMoreItems.push({ header: { en: group.en, hi: group.hi }, items });
  }

  const isActive = (href: string) => isNavItemActive(pathname ?? '', href);
  const hasMultipleRoles = roles.length > 1;

  const handleRoleSwitch = (role: typeof activeRole) => {
    setActiveRole(role);
    const config = ROLE_CONFIG[role];
    if (config?.homePath) {
      onClose();
      router.push(config.homePath);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 z-[60] animate-fade-in"
        style={{ background: 'rgba(0,0,0,0.3)' }}
        onClick={onClose}
        role="presentation"
        aria-hidden="true"
      />
      <div
        ref={moreSheetRef}
        role="dialog"
        aria-label="More navigation options"
        // `nav-more-sheet` insets the sheet past the tablet rail (768–1023px)
        // so the rail stays visible and the student keeps their orientation
        // while the overflow is open. Below 768 / above 1023 it is a no-op and
        // the Tailwind full-bleed geometry applies unchanged.
        className="nav-more-sheet fixed bottom-0 left-0 right-0 z-[70] rounded-t-3xl animate-slide-up"
        style={{
          background: 'var(--surface-1)',
          paddingBottom: 'env(safe-area-inset-bottom, 16px)',
          boxShadow: '0 -8px 40px rgba(0,0,0,0.12)',
        }}
      >
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 rounded-full" style={{ background: 'var(--border-mid, #ccc)' }} />
        </div>
        <div className="px-5 pb-4 space-y-1 max-h-[calc(80vh-48px)] overflow-y-auto overscroll-contain">
          {groupedMoreItems.map((group, gi) => (
            <div key={gi}>
              {group.header && (
                <p
                  className="text-[11px] font-bold uppercase tracking-widest px-4 pt-2 pb-1"
                  style={{ color: 'var(--text-3)' }}
                >
                  {isHi ? group.header.hi : group.header.en}
                </p>
              )}
              <div className="space-y-1">
                {group.items.map((item) => {
                  const lock = getItemLock(item);
                  const active = !lock.locked && isActive(item.href);
                  const gradeChipLabel = lock.locked
                    ? isHi
                      ? `कक्षा ${lock.gradeMin}+`
                      : `Grade ${lock.gradeMin}+`
                    : null;
                  return (
                    <button
                      key={item.href}
                      type="button"
                      onClick={
                        lock.locked
                          ? undefined
                          : () => {
                              onClose();
                              router.push(item.href);
                            }
                      }
                      aria-disabled={lock.locked || undefined}
                      aria-current={active ? 'page' : undefined}
                      aria-label={
                        lock.locked
                          ? `${isHi ? item.labelHi : item.label} — ${isHi ? 'अभी उपलब्ध नहीं' : 'locked'} · ${gradeChipLabel}`
                          : undefined
                      }
                      className="w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl text-left transition-all active:scale-[0.98]"
                      style={{
                        background: active ? 'rgb(var(--orange-rgb) / 0.08)' : 'transparent',
                        color: lock.locked
                          ? 'var(--text-3)'
                          : active
                            ? 'var(--orange)'
                            : 'var(--text-2)',
                        opacity: lock.locked ? 0.75 : 1,
                        cursor: lock.locked ? 'not-allowed' : 'pointer',
                        minHeight: 'var(--tap-min)',
                      }}
                    >
                      <span className="text-xl w-7 text-center" aria-hidden="true">
                        {item.icon}
                      </span>
                      <span className="text-sm font-semibold">
                        {isHi ? item.labelHi : item.label}
                      </span>
                      {lock.locked ? (
                        <span
                          className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
                          style={{
                            background: 'var(--surface-3)',
                            color: 'var(--text-3)',
                            border: '1px solid var(--border)',
                          }}
                        >
                          <span aria-hidden="true">🔒</span>
                          {gradeChipLabel}
                        </span>
                      ) : active ? (
                        <span
                          className="ml-auto w-1.5 h-1.5 rounded-full"
                          style={{ background: 'var(--orange)' }}
                        />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {showUpgradePill && (
            <div className="pt-3 mt-2" style={{ borderTop: '1px solid var(--border)' }}>
              <a
                href="/pricing"
                onClick={() => {
                  onClose();
                  if (typeof window !== 'undefined') {
                    try {
                      window.dispatchEvent(
                        new CustomEvent('alfanumrik:upgrade-cta-click', {
                          detail: {
                            source: 'nav_more_sheet',
                            variant: 'pill',
                            timestamp: Date.now(),
                          },
                        }),
                      );
                    } catch {
                      /* non-blocking */
                    }
                  }
                }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--purple)] focus-visible:ring-offset-2"
                style={{
                  background:
                    'linear-gradient(135deg, rgb(var(--purple-rgb) / 0.10), rgb(var(--orange-rgb) / 0.08))',
                  border: '1px solid rgb(var(--purple-rgb) / 0.25)',
                }}
              >
                <span
                  className="inline-flex items-center justify-center w-8 h-8 rounded-xl shrink-0"
                  style={{
                    background: 'linear-gradient(135deg, var(--purple), var(--purple-light))',
                    color: 'white',
                  }}
                  aria-hidden="true"
                >
                  ✨
                </span>
                <span className="flex flex-col flex-1 min-w-0">
                  <span className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>
                    {isHi ? 'प्रीमियम पर अपग्रेड करें' : 'Upgrade to Premium'}
                  </span>
                  <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                    {isHi ? 'और चैट, अनलिमिटेड क्विज़' : 'More chats, unlimited quizzes'}
                  </span>
                </span>
                <span className="text-xs font-bold" style={{ color: 'var(--purple)' }} aria-hidden="true">
                  →
                </span>
              </a>
            </div>
          )}
          {hasMultipleRoles && (
            <div className="pt-2 mt-2" style={{ borderTop: '1px solid var(--border)' }}>
              <p className="text-[11px] font-bold text-[var(--text-3)] uppercase tracking-widest px-4 mb-1.5">
                {isHi ? 'भूमिका बदलें' : 'Switch Role'}
              </p>
              {roles
                .filter((r) => r !== 'none')
                .map((role) => {
                  const cfg = ROLE_CONFIG[role];
                  const isCurrent = role === activeRole;
                  return (
                    <button
                      key={role}
                      type="button"
                      onClick={() => handleRoleSwitch(role)}
                      aria-label={isHi ? cfg.labelHi : cfg.label}
                      aria-current={isCurrent ? 'true' : undefined}
                      className="w-full flex items-center gap-4 px-4 py-3 rounded-2xl text-left transition-all active:scale-[0.98]"
                      style={{
                        background: isCurrent ? `${cfg.color}12` : 'transparent',
                        color: isCurrent ? cfg.color : 'var(--text-2)',
                        minHeight: 'var(--tap-min)',
                      }}
                    >
                      <span className="text-xl w-7 text-center" aria-hidden="true">
                        {cfg.icon}
                      </span>
                      <span className="text-sm font-semibold">{isHi ? cfg.labelHi : cfg.label}</span>
                      {isCurrent && (
                        <span
                          className="ml-auto text-xs px-2 py-0.5 rounded-full"
                          style={{ background: `${cfg.color}20`, color: cfg.color }}
                        >
                          {isHi ? 'सक्रिय' : 'Active'}
                        </span>
                      )}
                    </button>
                  );
                })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default NavMoreSheet;
