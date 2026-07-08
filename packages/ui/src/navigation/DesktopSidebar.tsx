'use client';

import { useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth, type UserRole } from '@alfanumrik/lib/AuthContext';
import { useDashboardData, useFeatureFlags } from '@alfanumrik/lib/swr';
import { getSidebarSections, getItemLockForGrade, isItemVisibleForFlags, type NavFlagGatedItem } from './nav-config';

export function DesktopSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const auth = useAuth();
  const isHi = auth?.isHi ?? false;
  const { activeRole } = auth;
  const [collapsed, setCollapsed] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({ Account: true });
  
  const { data: navFlags } = useFeatureFlags();
  const [hasUpcomingExam] = useState(true);

  const studentGrade = parseInt((auth as any)?.student?.grade ?? '6', 10);
  const getItemLock = (item: any) => getItemLockForGrade(item, studentGrade);

  const passesExamGate = (item: any): boolean =>
    !(item?.requiresUpcomingExam === true && !hasUpcomingExam);

  // Consumer Minimalism Wave A — surface the adaptive "Today" home in the
  // sidebar's first section when ff_today_home_v1 is ON (student only). When
  // OFF this branch is skipped and the sidebar is byte-identical to today.
  const todayHomeOn = navFlags?.ff_today_home_v1 === true;

  const sidebarSections = getSidebarSections(activeRole)
    .filter(s => {
      const gMin = (s as any).gradeMin;
      return gMin == null || studentGrade >= gMin;
    })
    .map((section, idx) => ({
      ...section,
      items: [
        ...(todayHomeOn && activeRole === 'student' && idx === 0
          ? [{ href: '/today', icon: '☀️', label: 'Today', labelHi: 'आज' }]
          : []),
        ...section.items,
      ]
        .filter(item => isItemVisibleForFlags(item as NavFlagGatedItem, navFlags))
        .filter(passesExamGate),
    }));

  const { data: dashData } = useDashboardData((auth as any)?.student?.id);
  const dueCount: number = (dashData as any)?.due_count ?? 0;

  const isActive = (href: string) => pathname === href || (href !== '/' && pathname.startsWith(href));
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

        <div className="space-y-5">
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
                    const isReview = item.href === '/review';
                    const showReviewBadge = !lock.locked && isReview && dueCount > 0 && activeRole === 'student';
                    const gradeChipLabel = lock.locked
                      ? (isHi ? `कक्षा ${lock.gradeMin}+` : `Grade ${lock.gradeMin}+`)
                      : null;
                    return (
                      <button
                        key={item.href}
                        type="button"
                        onClick={lock.locked ? undefined : () => {
                          if (item.href === '/foxy') window.location.href = '/foxy';
                          else router.push(item.href);
                        }}
                        aria-disabled={lock.locked || undefined}
                        aria-label={lock.locked
                          ? `${isHi ? item.labelHi : item.label} — ${isHi ? 'अभी उपलब्ध नहीं' : 'locked'} · ${gradeChipLabel}`
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
                        ) : showReviewBadge && !collapsed ? (
                          <span className="ml-auto min-w-[18px] h-[18px] rounded-full flex items-center justify-center text-[9px] font-bold text-white px-1"
                            style={{ background: '#DC2626' }}>
                            {dueCount > 9 ? '9+' : dueCount}
                          </span>
                        ) : active && !collapsed ? (
                          <span className="ml-auto w-1.5 h-1.5 rounded-full" style={{ background: 'var(--orange)' }} />
                        ) : null}
                      </button>
                    );
                  })}
                </div>}
              </div>
            );
          })}
        </div>
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
