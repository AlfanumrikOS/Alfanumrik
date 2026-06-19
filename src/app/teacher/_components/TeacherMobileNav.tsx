'use client';

import { useState, useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';

interface TeacherMobileNavProps {
  commandCenterOn: boolean;
  messagesUnread: number;
  moduleEnablement: Record<string, boolean> | null;
  isHi: boolean;
  onLogout: () => void;
}

interface NavTab {
  href: string;
  label: string;
  labelHi: string;
  icon: string;
  exact?: boolean;
  isBadge?: boolean;
  moduleKey?: string;
}

// 4 primary tabs for Command Center mode (ff_teacher_command_center ON)
const SLIM_TABS: NavTab[] = [
  { href: '/teacher', label: 'Command Center', labelHi: 'कमांड सेंटर', icon: '▦', exact: true },
  { href: '/teacher/grade-book', label: 'Gradebook', labelHi: 'ग्रेड बुक', icon: '⊟', moduleKey: 'assignments' },
  { href: '/teacher/assignments', label: 'Assignments', labelHi: 'असाइनमेंट', icon: '⊠', moduleKey: 'assignments' },
  { href: '/teacher/messages', label: 'Messages', labelHi: 'संदेश', icon: '✉', isBadge: true },
];

// 4 primary tabs for legacy mode (ff_teacher_command_center OFF)
const LEGACY_TABS: NavTab[] = [
  { href: '/teacher', label: 'Dashboard', labelHi: 'डैशबोर्ड', icon: '▦', exact: true },
  { href: '/teacher/classes', label: 'Classes', labelHi: 'कक्षाएं', icon: '⊞' },
  { href: '/teacher/students', label: 'Students', labelHi: 'छात्र', icon: '⊕' },
  { href: '/teacher/messages', label: 'Messages', labelHi: 'संदेश', icon: '✉', isBadge: true },
];

// Overflow items for Command Center mode — mirrors TEACHER_OVERFLOW_ITEMS from TeacherShell.
const SLIM_MORE_ITEMS: NavTab[] = [
  { href: '/teacher/classes', label: 'Classes', labelHi: 'कक्षाएं', icon: '⊞' },
  { href: '/teacher/students', label: 'Students', labelHi: 'छात्र', icon: '⊕' },
  { href: '/teacher/submissions', label: 'Submissions', labelHi: 'सबमिशन', icon: '⊞', moduleKey: 'assignments' },
  { href: '/teacher/worksheets', label: 'Worksheets', labelHi: 'वर्कशीट', icon: '⊡', moduleKey: 'lms' },
  { href: '/teacher/lab-leaderboard', label: 'Lab Leaderboard', labelHi: 'लैब लीडरबोर्ड', icon: '⊙' },
  { href: '/teacher/profile', label: 'Profile', labelHi: 'प्रोफ़ाइल', icon: '◎' },
];

// Overflow items for legacy mode — remaining NAV_ITEMS not in LEGACY_TABS.
const LEGACY_MORE_ITEMS: NavTab[] = [
  { href: '/teacher/assignments', label: 'Assignments', labelHi: 'असाइनमेंट', icon: '⊠', moduleKey: 'assignments' },
  { href: '/teacher/submissions', label: 'Submissions', labelHi: 'सबमिशन', icon: '⊞', moduleKey: 'assignments' },
  { href: '/teacher/grade-book', label: 'Grade Book', labelHi: 'ग्रेड बुक', icon: '⊟', moduleKey: 'assignments' },
  { href: '/teacher/worksheets', label: 'Worksheets', labelHi: 'वर्कशीट', icon: '⊡', moduleKey: 'lms' },
  { href: '/teacher/reports', label: 'Reports', labelHi: 'रिपोर्ट', icon: '⊘', moduleKey: 'analytics' },
  { href: '/teacher/lab-leaderboard', label: 'Lab Leaderboard', labelHi: 'लैब लीडरबोर्ड', icon: '⊙' },
  { href: '/teacher/profile', label: 'Profile', labelHi: 'प्रोफ़ाइल', icon: '◎' },
];

function isModuleVisible(tab: NavTab, moduleEnablement: Record<string, boolean> | null): boolean {
  if (!tab.moduleKey) return true;
  if (moduleEnablement === null) return true; // fail-open
  return moduleEnablement[tab.moduleKey] !== false;
}

export default function TeacherMobileNav({
  commandCenterOn,
  messagesUnread,
  moduleEnablement,
  isHi,
  onLogout,
}: TeacherMobileNavProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [showMore, setShowMore] = useState(false);
  const moreSheetRef = useRef<HTMLDivElement>(null);

  // rAF scroll-hide — 8px threshold, hides after 80px scroll-down,
  // restores on scroll-up or when y < 80.
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

  // ESC closes More sheet; auto-focus first button when More sheet opens.
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

  const isActive = (href: string, exact?: boolean) => {
    if (exact) return pathname === href;
    return pathname === href || pathname.startsWith(href + '/');
  };

  const primaryTabs = commandCenterOn ? SLIM_TABS : LEGACY_TABS;
  const moreItems = (commandCenterOn ? SLIM_MORE_ITEMS : LEGACY_MORE_ITEMS).filter(item =>
    isModuleVisible(item, moduleEnablement),
  );

  const visibleTabs = primaryTabs.filter(tab => isModuleVisible(tab, moduleEnablement));

  const isMoreActive = moreItems.some(item => isActive(item.href));

  const getBadgeCount = (tab: NavTab): number => {
    if (tab.isBadge && tab.href === '/teacher/messages') return messagesUnread;
    return 0;
  };

  // Dark background for the teacher portal (bg-[#0B1120] theme).
  const darkNavStyle = {
    background: 'rgba(11, 17, 32, 0.92)',
    backdropFilter: 'blur(14px) saturate(140%)',
    WebkitBackdropFilter: 'blur(14px) saturate(140%)',
    borderTop: '1px solid rgba(255, 255, 255, 0.08)',
    paddingBottom: 'env(safe-area-inset-bottom, 0px)',
  } as React.CSSProperties;

  const activeColor = 'rgba(255,255,255,0.9)';
  const inactiveColor = 'rgba(148, 163, 184, 0.7)'; // slate-400 / 70%

  return (
    <>
      {showMore && (
        <>
          <div
            className="fixed inset-0 z-[60] bg-black/30"
            onClick={() => setShowMore(false)}
            role="presentation"
            aria-hidden="true"
          />
          <div
            ref={moreSheetRef}
            role="dialog"
            aria-label={isHi ? 'अधिक नेविगेशन विकल्प' : 'More navigation options'}
            className="fixed bottom-0 left-0 right-0 z-[70] rounded-t-3xl"
            style={{
              background: 'rgba(15, 23, 42, 0.97)',
              paddingBottom: 'env(safe-area-inset-bottom, 16px)',
              boxShadow: '0 -8px 40px rgba(0,0,0,0.4)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            {/* Handle bar */}
            <div className="flex justify-center pt-3 pb-2">
              <div
                className="w-10 h-1 rounded-full"
                style={{ background: 'rgba(255,255,255,0.2)' }}
              />
            </div>
            <div className="px-5 pb-4 space-y-1">
              {moreItems.map(item => {
                const active = isActive(item.href);
                return (
                  <button
                    key={item.href}
                    type="button"
                    onClick={() => { setShowMore(false); router.push(item.href); }}
                    className="w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl text-left transition-all active:scale-[0.98]"
                    style={{
                      background: active ? 'rgba(99, 102, 241, 0.12)' : 'transparent',
                      color: active ? 'rgba(165,180,252,1)' : 'rgba(148,163,184,0.85)',
                    }}
                  >
                    <span className="text-xl w-7 text-center" aria-hidden="true">{item.icon}</span>
                    <span className="text-sm font-semibold">{isHi ? item.labelHi : item.label}</span>
                    {active && (
                      <span
                        className="ml-auto w-1.5 h-1.5 rounded-full"
                        style={{ background: 'rgba(165,180,252,1)' }}
                      />
                    )}
                  </button>
                );
              })}
              {/* Logout at bottom of More sheet */}
              <div
                className="pt-3 mt-2"
                style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}
              >
                <button
                  type="button"
                  onClick={() => { setShowMore(false); onLogout(); }}
                  className="w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl text-left transition-all active:scale-[0.98]"
                  style={{ color: 'rgba(148,163,184,0.7)' }}
                >
                  <span className="text-xl w-7 text-center" aria-hidden="true">🚪</span>
                  <span className="text-sm font-semibold">{isHi ? 'लॉगआउट' : 'Logout'}</span>
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      <nav
        className="bottom-nav-mobile fixed bottom-0 left-0 right-0 z-50"
        aria-label={isHi ? 'मुख्य नेविगेशन' : 'Main navigation'}
        role="navigation"
        data-scroll-hidden={navHidden ? 'true' : 'false'}
        style={darkNavStyle}
      >
        <div className="flex items-end justify-around px-2 pt-2 pb-1">
          {visibleTabs.map(tab => {
            const active = isActive(tab.href, tab.exact);
            const badgeCount = getBadgeCount(tab);
            return (
              <button
                key={tab.href}
                type="button"
                onClick={() => router.push(tab.href)}
                aria-label={isHi ? tab.labelHi : tab.label}
                aria-current={active ? 'page' : undefined}
                className="flex flex-col items-center gap-0.5 py-1.5 px-2 bg-transparent border-0 min-w-[44px] min-h-[44px] justify-center"
                style={{ color: active ? activeColor : inactiveColor }}
              >
                <span
                  className="relative inline-block"
                  style={{
                    fontSize: 22,
                    lineHeight: 1,
                    transform: active ? 'translateY(-1px) scale(1.06)' : 'scale(1)',
                    transition: 'transform 200ms cubic-bezier(.22,1,.36,1)',
                  }}
                  aria-hidden="true"
                >
                  {tab.icon}
                  {badgeCount > 0 && (
                    <span
                      className="absolute -top-1.5 -right-2.5 min-w-[16px] h-[16px] rounded-full flex items-center justify-center text-[9px] font-bold text-white px-0.5"
                      style={{ background: '#DC2626', border: '1.5px solid rgba(11,17,32,1)' }}
                    >
                      {badgeCount > 9 ? '9+' : badgeCount}
                    </span>
                  )}
                </span>
                <span
                  className="tracking-wide"
                  style={{
                    fontSize: 'var(--text-2xs, 10px)',
                    fontWeight: active ? 700 : 600,
                    letterSpacing: '0.02em',
                  }}
                >
                  {isHi ? tab.labelHi : tab.label}
                </span>
              </button>
            );
          })}

          {/* More button */}
          <button
            type="button"
            onClick={() => setShowMore(!showMore)}
            aria-label={isHi ? 'अधिक विकल्प' : 'More options'}
            aria-expanded={showMore}
            className="flex flex-col items-center gap-0.5 py-1.5 px-2 bg-transparent border-0 min-w-[44px] min-h-[44px] justify-center"
            style={{ color: isMoreActive ? activeColor : inactiveColor }}
          >
            <span aria-hidden="true" style={{ fontSize: 22, lineHeight: 1 }}>⋯</span>
            <span
              className="tracking-wide"
              style={{
                fontSize: 'var(--text-2xs, 10px)',
                fontWeight: isMoreActive ? 700 : 600,
                letterSpacing: '0.02em',
              }}
            >
              {isHi ? 'अधिक' : 'More'}
            </span>
          </button>
        </div>
      </nav>
    </>
  );
}
