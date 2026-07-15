'use client';

import { useState, useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { supabase } from '@alfanumrik/lib/supabase';
import { ROLE_CONFIG } from '@alfanumrik/lib/constants';
import { useDashboardData, useFeatureFlags } from '@alfanumrik/lib/swr';
import { getCoreTabs, getMoreItems, getItemLockForGrade, isItemVisibleForFlags, type NavFlagGatedItem } from './nav-config';

export function MobileBottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const auth = useAuth();
  const isHi = auth?.isHi ?? false;
  const { roles, activeRole, setActiveRole } = auth;
  const [showMore, setShowMore] = useState(false);
  const moreSheetRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (showMore && moreSheetRef.current) {
      const firstButton = moreSheetRef.current.querySelector('button');
      firstButton?.focus();
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showMore) setShowMore(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showMore]);

  const { data: navFlags } = useFeatureFlags();
  const [hasUpcomingExam, setHasUpcomingExam] = useState(false);

  const student = (auth as any)?.student;
  useEffect(() => {
    const studentId = student?.id;
    if (!studentId) return;
    let cancelled = false;
    supabase
      .from('student_exams')
      .select('id')
      .eq('student_id', studentId)
      .gte('exam_date', new Date().toISOString())
      .limit(1)
      .then(({ data }) => {
        if (!cancelled) setHasUpcomingExam((data?.length ?? 0) > 0);
      });
    return () => { cancelled = true; };
  }, [student?.id]);

  const tabs = getCoreTabs(activeRole);
  const studentGrade = parseInt(student?.grade ?? '6', 10);
  const getItemLock = (item: any) => getItemLockForGrade(item, studentGrade);
  const subscriptionPlan = (student?.subscription_plan as string | null | undefined) ?? null;
  const showUpgradePill = activeRole === 'student' && (subscriptionPlan === null || subscriptionPlan === 'free');

  const passesExamGate = (item: any): boolean =>
    !(item?.requiresUpcomingExam === true && !hasUpcomingExam);

  const moreItems = getMoreItems(activeRole)
    .filter(item => isItemVisibleForFlags(item as NavFlagGatedItem, navFlags))
    .filter(passesExamGate);

  const { data: dashData } = useDashboardData(student?.id);
  const dueCount: number = (dashData as any)?.due_count ?? 0;
  const streakCount: number = (auth as any)?.snapshot?.current_streak ?? 0;

  const isActive = (href: string) => pathname === href || (href !== '/' && pathname.startsWith(href));

  const isMoreActive = moreItems.some(m => !getItemLock(m).locked && isActive(m.href));
  const hasMultipleRoles = roles.length > 1;

  const handleRoleSwitch = (role: typeof activeRole) => {
    setActiveRole(role);
    const config = ROLE_CONFIG[role];
    if (config?.homePath) {
      setShowMore(false);
      router.push(config.homePath);
    }
  };

  return (
    <>
      {showMore && (
        <>
          <div
            className="fixed inset-0 z-[60]"
            style={{ background: 'rgba(0,0,0,0.3)' }}
            onClick={() => setShowMore(false)}
            role="presentation"
            aria-hidden="true"
          />
          <div
            ref={moreSheetRef}
            role="dialog"
            aria-label="More navigation options"
            className="fixed bottom-0 left-0 right-0 z-[70] rounded-t-3xl"
            style={{
              background: 'var(--surface-1)',
              paddingBottom: 'env(safe-area-inset-bottom, 16px)',
              boxShadow: '0 -8px 40px rgba(0,0,0,0.12)',
            }}
          >
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-10 h-1 rounded-full" style={{ background: 'var(--border-mid, #ccc)' }} />
            </div>
            <div className="px-5 pb-4 space-y-1">
              {moreItems.map(item => {
                const lock = getItemLock(item);
                const active = !lock.locked && isActive(item.href);
                const gradeChipLabel = lock.locked
                  ? (isHi ? `कक्षा ${lock.gradeMin}+` : `Grade ${lock.gradeMin}+`)
                  : null;
                return (
                  <button
                    key={item.href}
                    type="button"
                    onClick={lock.locked
                      ? undefined
                      : () => { setShowMore(false); router.push(item.href); }}
                    aria-disabled={lock.locked || undefined}
                    aria-label={lock.locked
                      ? `${isHi ? item.labelHi : item.label} — ${isHi ? 'अभी उपलब्ध नहीं' : 'locked'} · ${gradeChipLabel}`
                      : undefined}
                    className="w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl text-left transition-all active:scale-[0.98]"
                    style={{
                      background: active ? 'rgb(var(--orange-rgb) / 0.08)' : 'transparent',
                      color: lock.locked ? 'var(--text-3)' : (active ? 'var(--orange)' : 'var(--text-2)'),
                      opacity: lock.locked ? 0.75 : 1,
                      cursor: lock.locked ? 'not-allowed' : 'pointer',
                    }}
                  >
                    <span className="text-xl w-7 text-center" aria-hidden="true">{item.icon}</span>
                    <span className="text-sm font-semibold">{isHi ? item.labelHi : item.label}</span>
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
                    ) : item.href === '/review' && dueCount > 0 && activeRole === 'student' ? (
                      <span className="ml-auto min-w-[18px] h-[18px] rounded-full flex items-center justify-center text-[9px] font-bold text-white px-1"
                        style={{ background: '#DC2626' }}>
                        {dueCount > 9 ? '9+' : dueCount}
                      </span>
                    ) : active ? (
                      <span className="ml-auto w-1.5 h-1.5 rounded-full" style={{ background: 'var(--orange)' }} />
                    ) : null}
                  </button>
                );
              })}
              {showUpgradePill && (
                <div className="pt-3 mt-2" style={{ borderTop: '1px solid var(--border)' }}>
                  <a
                    href="/pricing"
                    onClick={() => {
                      setShowMore(false);
                      if (typeof window !== 'undefined') {
                        try {
                          window.dispatchEvent(new CustomEvent('alfanumrik:upgrade-cta-click', {
                            detail: { source: 'nav_more_sheet', variant: 'pill', timestamp: Date.now() },
                          }));
                        } catch { /* non-blocking */ }
                      }
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--purple)] focus-visible:ring-offset-2"
                    style={{
                      background: 'linear-gradient(135deg, rgb(var(--purple-rgb) / 0.10), rgb(var(--orange-rgb) / 0.08))',
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
                    <span className="text-xs font-bold" style={{ color: 'var(--purple)' }} aria-hidden="true">→</span>
                  </a>
                </div>
              )}
              {hasMultipleRoles && (
                <div className="pt-2 mt-2" style={{ borderTop: '1px solid var(--border)' }}>
                  <p className="text-[11px] font-bold text-[var(--text-3)] uppercase tracking-widest px-4 mb-1.5">
                    {isHi ? 'भूमिका बदलें' : 'Switch Role'}
                  </p>
                  {roles.filter(r => r !== 'none').map(role => {
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
                        }}
                      >
                        <span className="text-xl w-7 text-center" aria-hidden="true">{cfg.icon}</span>
                        <span className="text-sm font-semibold">{isHi ? cfg.labelHi : cfg.label}</span>
                        {isCurrent && <span className="ml-auto text-xs px-2 py-0.5 rounded-full" style={{ background: `${cfg.color}20`, color: cfg.color }}>{isHi ? 'सक्रिय' : 'Active'}</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      <nav
        className="bottom-nav-mobile fixed bottom-0 left-0 right-0 z-50"
        aria-label="Main navigation"
        role="navigation"
        data-scroll-hidden={navHidden ? 'true' : 'false'}
        style={{
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        <div className="flex items-end justify-around px-2 pt-2 pb-1">
          {tabs.map((item) => {
            const active = isActive(item.href);

            if (activeRole === 'student' && 'isFab' in item && item.isFab) {
              return (
                <button
                  key={item.href}
                  onClick={() => router.push(item.href)}
                  aria-label={isHi ? item.labelHi : item.label}
                  aria-current={active ? 'page' : undefined}
                  className="touchable flex flex-col items-center -mt-3 active:scale-95 transition-transform bg-transparent border-0"
                  style={{ minWidth: 'var(--tap-comfort)' }}
                >
                  <span
                    className="flex items-center justify-center rounded-2xl"
                    style={{
                      width: 52,
                      height: 52,
                      marginTop: -12,
                      background: active
                        ? 'linear-gradient(135deg, var(--accent), var(--gold))'
                        : 'linear-gradient(135deg, var(--accent), #D84315)',
                      boxShadow: '0 8px 20px rgb(var(--orange-rgb) / 0.42)',
                      color: '#fff',
                      fontSize: 26,
                      lineHeight: 1,
                    }}
                    aria-hidden="true"
                  >
                    {item.icon}
                  </span>
                  <span
                    className="font-bold mt-1"
                    style={{
                      fontSize: 'var(--text-2xs)',
                      letterSpacing: '0.02em',
                      color: active ? 'var(--accent)' : 'var(--ink-2)',
                    }}
                  >
                    {isHi ? item.labelHi : item.label}
                  </span>
                </button>
              );
            }

            return (
              <button
                key={item.href}
                onClick={() => router.push(item.href)}
                aria-label={isHi ? item.labelHi : item.label}
                aria-current={active ? 'page' : undefined}
                data-active={active ? 'true' : 'false'}
                className="touchable bottom-nav-mobile__slot flex flex-col items-center gap-0.5 py-1.5 px-2 bg-transparent border-0 relative"
                style={{
                  color: active ? 'var(--accent)' : 'var(--ink-3)',
                  minWidth: 'var(--tap-comfort)',
                }}
              >
                <span
                  className="relative inline-block"
                  style={{
                    fontSize: 22,
                    lineHeight: 1,
                    transform: active ? 'translateY(-1px) scale(1.06)' : 'scale(1)',
                    transition: 'transform 200ms cubic-bezier(.22,1,.36,1)',
                    filter: active ? 'drop-shadow(0 0 6px rgb(var(--orange-rgb) / 0.3))' : 'none',
                  }}
                  aria-hidden="true"
                >
                  {active ? item.activeIcon : item.icon}
                  {item.href === '/today' && streakCount > 0 && activeRole === 'student' && (
                    <span
                      className="absolute -top-1.5 -right-2.5 min-w-[18px] h-[16px] rounded-full flex items-center justify-center text-[9px] font-bold px-0.5"
                      style={{
                        background: '#F59E0B',
                        color: '#fff',
                        border: '1.5px solid var(--bg)',
                      }}
                      aria-label={`${streakCount} day streak`}
                    >
                      {streakCount}
                    </span>
                  )}
                </span>
                <span
                  className="tracking-wide"
                  style={{
                    fontSize: 'var(--text-2xs)',
                    fontWeight: active ? 700 : 600,
                    letterSpacing: '0.02em',
                  }}
                >
                  {isHi ? item.labelHi : item.label}
                </span>
              </button>
            );
          })}

          <button
            onClick={() => setShowMore(!showMore)}
            aria-label={isHi ? 'अधिक विकल्प' : 'More options'}
            aria-expanded={showMore}
            data-active={isMoreActive ? 'true' : 'false'}
            className="touchable bottom-nav-mobile__slot flex flex-col items-center gap-0.5 py-1.5 px-2 bg-transparent border-0 relative"
            style={{
              color: isMoreActive ? 'var(--accent)' : 'var(--ink-3)',
              minWidth: 'var(--tap-comfort)',
            }}
          >
            <span
              aria-hidden="true"
              style={{ fontSize: 22, lineHeight: 1 }}
            >
              &#x2630;
            </span>
            <span
              className="tracking-wide"
              style={{
                fontSize: 'var(--text-2xs)',
                fontWeight: isMoreActive ? 700 : 600,
                letterSpacing: '0.02em',
              }}
            >
              {isHi ? 'और' : 'More'}
            </span>
          </button>
        </div>
      </nav>
    </>
  );
}
