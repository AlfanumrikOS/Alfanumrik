'use client';

import { useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth, type UserRole } from '@alfanumrik/lib/AuthContext';
import { useFeatureFlags } from '@alfanumrik/lib/swr';
import { getSidebarSections, getItemLockForGrade, isItemVisibleForFlags, resolveActiveNavHref, type NavFlagGatedItem } from './nav-config';
import { useHasUpcomingExam } from './use-has-upcoming-exam';
// Imported from the MODULE, not '../ui/primitives' (the barrel), so the
// always-mounted sidebar does not drag the whole primitive library into the
// shared first-load chunk (P10).
import { Tooltip } from '../ui/primitives/Tooltip';

/**
 * Sections that start CLOSED. Account was already closed by default; the two
 * grouped-secondary-nav sections (ff_nav_groups_v1) join it so turning the
 * flag on adds eight destinations without turning the sidebar into a wall of
 * twenty links on first paint. The student opens what they want; the state is
 * per-session, exactly as it already was for Account.
 *
 * Keyed by section TITLE, matching the existing collapse map.
 */
const DEFAULT_COLLAPSED_SECTIONS: Record<string, boolean> = {
  Account: true,
  'Practice & Tests': true,
  Explore: true,
};

export function DesktopSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const auth = useAuth();
  const isHi = auth?.isHi ?? false;
  const { activeRole } = auth;
  const [collapsed, setCollapsed] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>(
    () => ({ ...DEFAULT_COLLAPSED_SECTIONS }),
  );
  
  const { data: navFlags } = useFeatureFlags();
  // Was `useState(true)` — hard-coded, never set, never derived, so "Exam
  // Sprint" always rendered on desktop while MobileBottomNav genuinely gated
  // it. Both surfaces now share one derivation.
  const hasUpcomingExam = useHasUpcomingExam((auth as any)?.student?.id);

  const studentGrade = parseInt((auth as any)?.student?.grade ?? '6', 10);
  const getItemLock = (item: any) => getItemLockForGrade(item, studentGrade);

  const passesExamGate = (item: any): boolean =>
    !(item?.requiresUpcomingExam === true && !hasUpcomingExam);

  // Consumer Minimalism Wave A — the adaptive "Today" home used to be spliced
  // in here imperatively at section index 0, then (2026-08-09) became a
  // flagName-gated entry in SIDEBAR_SECTIONS' "Main" section. Since the Phase 3
  // IA trim (2026-08-10) it is an UNGATED entry there: the "Home" (/dashboard)
  // row that used to cover the flag-OFF case is gone, so gating Today would
  // leave this sidebar with no home destination. /today redirects to
  // /dashboard while ff_today_home_v1 is OFF, so it is never a dead end. The
  // isItemVisibleForFlags filter below still enforces every OTHER flagName in
  // the list (today: only /me's ff_me_v2).
  const sidebarSections = getSidebarSections(activeRole)
    .filter(s => {
      const gMin = (s as any).gradeMin;
      return gMin == null || studentGrade >= gMin;
    })
    .map(section => ({
      ...section,
      items: section.items
        .filter(item => isItemVisibleForFlags(item as NavFlagGatedItem, navFlags))
        .filter(passesExamGate),
    }))
    // EMPTY-SECTION SKIP — the sidebar twin of NavMoreSheet's empty-group
    // skip, and load-bearing for the ff_nav_groups_v1 rollout. Every item in
    // the "Practice & Tests" and "Explore" sections carries that flag, so with
    // it OFF both sections filter down to zero items; without this line the
    // sidebar would render two disclosure headers that expand onto nothing.
    // No pre-existing section can hit this branch (each has >= 1 ungated
    // item), so with the flag off the rendered sidebar is unchanged.
    .filter(section => section.items.length > 0);

  // Single-winner active resolution across the WHOLE sidebar, so exactly one
  // item can carry aria-current="page". A per-item isNavItemActive() loop
  // could mark two (e.g. the primary Practice slot's /quiz alt and the
  // Practice section's own /quiz entry); resolveActiveNavHref prefers the
  // longest match, so the more specific entry wins.
  const activeHref = resolveActiveNavHref(
    pathname ?? '',
    sidebarSections.flatMap(section =>
      section.items
        .filter(item => !getItemLock(item).locked)
        .map(item => item.href),
    ),
  );
  const isActive = (href: string) => href === activeHref;
  const isFocusedFoxy = pathname === '/foxy' || pathname.startsWith('/foxy');

  // Fallback for browsers without :has() support (Safari < 15.4, Firefox < 121).
  // Only add the class when the sidebar is actually visible (not on /foxy).
  useEffect(() => {
    if (isFocusedFoxy) return;
    document.body.classList.add('has-sidebar');
    return () => document.body.classList.remove('has-sidebar');
  }, [isFocusedFoxy]);

  if (isFocusedFoxy) return null;

  return (
    <aside
      className={`sidebar-nav flex-col border-r ${collapsed ? 'sidebar-collapsed' : ''}`}
      style={{
        background: 'var(--surface-1)',
        borderColor: 'var(--border)',
        width: collapsed ? '56px' : 'var(--sidebar-width)',
        height: '100dvh',
        position: 'fixed',
        top: 0,
        left: 0,
        zIndex: 50,
        padding: collapsed ? '20px 6px' : '20px 12px',
        justifyContent: 'space-between',
        overflowY: 'auto',
        overflowX: 'hidden',
        transition: 'width 0.25s ease, padding 0.25s ease',
      }}
    >
      <div>
        <button
          onClick={() => router.push('/dashboard')}
          aria-label={isHi ? 'डैशबोर्ड पर जाएं' : 'Go to Dashboard'}
          className="flex items-center gap-2.5 px-3 mb-6 transition-opacity hover:opacity-80"
        >
          <span className="text-2xl">🦊</span>
          {!collapsed && <div>
            <div className="text-base font-bold gradient-text" style={{ fontFamily: 'var(--font-display)' }}>
              Alfanumrik
            </div>
            <div className="text-[11px] text-[var(--text-3)] -mt-0.5">AI Learning OS</div>
          </div>}
        </button>
        <button
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? 'Expand sidebar menu' : 'Collapse sidebar menu'}
          className="w-full flex items-center justify-center py-2 mb-2 rounded-lg transition-all hover:bg-[var(--surface-2)]"
          style={{ color: 'var(--text-3)' }}
          title={collapsed ? 'Expand menu' : 'Collapse menu'}
        >
          <span style={{ fontSize: 12 }}>{collapsed ? '\u00BB' : '\u00AB'}</span>
        </button>

        {/* The sidebar had NO navigation landmark: <aside> exposes role
            "complementary", so at 1024px+ the a11y tree had zero navigation
            regions. The bottom bar and the tablet rail carry the same
            accessible name; only one of the three tiers is ever in the tree
            because the other two are display:none at any given width. */}
        <nav aria-label="Main navigation" className="space-y-5">
          {sidebarSections.map(section => {
            const isSectionCollapsed = !collapsed && collapsedSections[section.title];
            const hasActiveItem = section.items.some(item => !getItemLock(item).locked && isActive(item.href));
            return (
              <div key={section.title}>
                {!collapsed && <button
                  onClick={() => setCollapsedSections(prev => ({ ...prev, [section.title]: !prev[section.title] }))}
                  className="w-full flex items-center justify-between text-[11px] font-bold text-[var(--text-3)] uppercase tracking-widest px-3 mb-1.5 hover:text-[var(--text-2)] transition-colors"
                  aria-expanded={!isSectionCollapsed}
                >
                  <span>{isHi ? section.titleHi : section.title}</span>
                  <span className="text-[9px] transition-transform" style={{ transform: isSectionCollapsed ? 'rotate(-90deg)' : 'rotate(0)' }}>
                    {isSectionCollapsed ? '▶' + (hasActiveItem ? ' •' : '') : '▼'}
                  </span>
                </button>}
                {!isSectionCollapsed && <div className="space-y-0.5">
                  {section.items.map(item => {
                    const lock = getItemLock(item);
                    const active = !lock.locked && isActive(item.href);
                    const isFoxy = item.href === '/foxy';
                    // The `/review` due-count badge that used to live here was
                    // dead code: `/review` is in none of CORE_TABS, MORE_ITEMS
                    // or SIDEBAR_SECTIONS (it is a permanent 301), so the branch
                    // could never render. Removing it also removed this
                    // component's only useDashboardData() call.
                    const gradeChipLabel = lock.locked
                      ? (isHi ? `कक्षा ${lock.gradeMin}+` : `Grade ${lock.gradeMin}+`)
                      : null;
                    const itemLabel = isHi ? item.labelHi : item.label;
                    // Collapsed (56px icon-only rail) the label span below is
                    // not rendered, so the hint carries the ONLY copy the
                    // student can read. Locked rows append the grade chip
                    // because their icon alone says nothing about why they do
                    // not respond.
                    const collapsedHint = lock.locked
                      ? `${itemLabel} · ${gradeChipLabel}`
                      : itemLabel;
                    const navButton = (
                      <button
                        key={item.href}
                        type="button"
                        onClick={lock.locked ? undefined : () => router.push(item.href)}
                        aria-disabled={lock.locked || undefined}
                        // The sidebar previously marked the active route with
                        // colour + a dot only — no programmatic current-page
                        // signal at all, so screen-reader users at 1024px+ had
                        // no "you are here". Matches the bottom bar and rail.
                        aria-current={active ? 'page' : undefined}
                        data-active={active ? 'true' : 'false'}
                        // Collapsed, the visible label span is not rendered, so
                        // an unlocked row had NO accessible name at all — the
                        // only child was an aria-hidden emoji. A tooltip does
                        // not fix that (aria-describedby is a description, not
                        // a name), so the name is supplied explicitly here.
                        // EXPANDED BEHAVIOUR IS UNCHANGED: still `undefined`,
                        // so the name still comes from the visible text.
                        aria-label={lock.locked
                          ? `${itemLabel} — ${isHi ? 'अभी उपलब्ध नहीं' : 'locked'} · ${gradeChipLabel}`
                          : collapsed
                            ? itemLabel
                            : undefined}
                        title={lock.locked && !collapsed
                          ? (isHi ? `कक्षा ${lock.gradeMin} में अनलॉक होगा` : `Unlocks in grade ${lock.gradeMin}`)
                          : undefined}
                        className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-all"
                        style={{
                          background: active
                            ? isFoxy ? 'rgb(var(--orange-rgb) / 0.12)' : 'rgb(var(--orange-rgb) / 0.06)'
                            : 'transparent',
                          color: lock.locked ? 'var(--text-3)' : (active ? 'var(--orange)' : 'var(--text-2)'),
                          fontWeight: active ? 600 : 500,
                          fontSize: '14px',
                          opacity: lock.locked ? 0.7 : 1,
                          cursor: lock.locked ? 'not-allowed' : 'pointer',
                          minHeight: 'var(--tap-min)',
                        }}
                      >
                        <span className="text-lg w-6 text-center" aria-hidden="true">{item.icon}</span>
                        {!collapsed && <span>{isHi ? item.labelHi : item.label}</span>}
                        {lock.locked && !collapsed ? (
                          <span
                            className="ml-auto inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold"
                            style={{
                              background: 'var(--surface-3)',
                              color: 'var(--text-3)',
                              border: '1px solid var(--border)',
                            }}
                          >
                            <span aria-hidden="true">🔒</span>
                            {gradeChipLabel}
                          </span>
                        ) : active && !collapsed ? (
                          <span className="ml-auto w-1.5 h-1.5 rounded-full" style={{ background: 'var(--orange)' }} />
                        ) : null}
                      </button>
                    );
                    // COLLAPSED-RAIL TOOLTIPS. At 56px the sidebar is icons
                    // only, with no labels and (until now) no hints — the
                    // collapsed nav was literally unreadable. The Tooltip
                    // primitive shows on hover AND on keyboard focus and wires
                    // aria-describedby, so it works for pointer and keyboard
                    // alike. `side="right"` points away from the leading edge.
                    // Expanded, the button is returned bare — identical markup
                    // to before this change.
                    return collapsed ? (
                      <Tooltip key={item.href} content={collapsedHint} side="right">
                        {navButton}
                      </Tooltip>
                    ) : (
                      navButton
                    );
                  })}
                </div>}
              </div>
            );
          })}
        </nav>
      </div>

      <div className="px-3 pt-4 mt-4 border-t" style={{ borderColor: 'var(--border)' }}>
        {collapsed ? <div className="text-center text-lg">🦊</div> : <div className="text-[11px] text-[var(--text-3)] leading-relaxed">
          <div>Alfanumrik Adaptive Learning OS</div>
          <div className="mt-0.5">Cusiosense Learning India Pvt Ltd</div>
        </div>}
      </div>
    </aside>
  );
}
