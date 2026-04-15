import { useState, useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth, type UserRole } from '@/lib/AuthContext';
import { ROLE_CONFIG } from '@/lib/constants';
import { useDashboardData } from '@/lib/swr';

/* ═══ NAVIGATION ARCHITECTURE ═══
 * Research-backed: Duolingo 5-tab model (the gold standard for EdTech)
 * - 5 bottom tabs max on mobile (thumb-zone optimized)
 * - Center position = primary action (Foxy AI tutor)
 * - "More" sheet for secondary features (no hidden features)
 * - Desktop sidebar groups by function with section headers
 * - Every page reachable in ≤ 2 taps
 */

/** Pure helper: determine whether a nav item is grade-locked for a student.
 *  Exported for unit testing the grade-gating policy without rendering the
 *  full nav shell. */
export interface NavGradeGatedItem {
  gradeMin?: number;
  [key: string]: unknown;
}
export function getItemLockForGrade(
  item: NavGradeGatedItem | null | undefined,
  studentGrade: number,
): { locked: boolean; gradeMin?: number } {
  const gMin = item?.gradeMin;
  if (typeof gMin === 'number' && studentGrade < gMin) {
    return { locked: true, gradeMin: gMin };
  }
  return { locked: false };
}

const CORE_TABS = [
  { href: '/dashboard', icon: '🏠', activeIcon: '🏠', label: 'Home', labelHi: 'होम' },
  { href: '/quiz', icon: '✏️', activeIcon: '✏️', label: 'Practice', labelHi: 'अभ्यास' },
  { href: '/foxy', icon: '🦊', activeIcon: '🦊', label: 'Foxy', labelHi: 'फॉक्सी', isFab: true },
  { href: '/progress', icon: '📈', activeIcon: '📈', label: 'Progress', labelHi: 'प्रगति' },
];

const MORE_ITEMS = [
  { href: '/simulations', icon: '🔬', label: 'STEM Lab', labelHi: 'STEM लैब' },
  { href: '/pyq', icon: '📄', label: 'PYQ Papers', labelHi: 'पिछले साल के प्रश्न', gradeMin: 9 },
  { href: '/mock-exam', icon: '📋', label: 'Mock Exam', labelHi: 'मॉक परीक्षा', gradeMin: 9 },
  { href: '/study-plan', icon: '📅', label: 'Study Plan', labelHi: 'स्टडी प्लान' },
  { href: '/leaderboard', icon: '🏆', label: 'Leaderboard', labelHi: 'लीडरबोर्ड' },
  { href: '/learn', icon: '📚', label: 'Subjects & Chapters', labelHi: 'विषय और अध्याय' },
  { href: '/review', icon: '🔄', label: 'Flashcard Review', labelHi: 'फ्लैशकार्ड रिव्यू' },
  { href: '/profile', icon: '👤', label: 'Profile', labelHi: 'प्रोफ़ाइल' },
  { href: '/notifications', icon: '🔔', label: 'Settings & Notifications', labelHi: 'सेटिंग्स और सूचनाएँ' },
  { href: '/help', icon: '❓', label: 'Help & Support', labelHi: 'सहायता और सपोर्ट' },
];

const SIDEBAR_SECTIONS = [
  {
    title: 'Home', titleHi: 'होम',
    items: [
      { href: '/dashboard', icon: '🏠', label: 'Home', labelHi: 'होम' },
      { href: '/foxy', icon: '🦊', label: 'Foxy AI Tutor', labelHi: 'फॉक्सी AI ट्यूटर' },
      { href: '/progress', icon: '📈', label: 'My Progress', labelHi: 'मेरी प्रगति' },
    ],
  },
  {
    title: 'Practice', titleHi: 'अभ्यास',
    items: [
      { href: '/quiz', icon: '✏️', label: 'Practice', labelHi: 'अभ्यास' },
      { href: '/simulations', icon: '🔬', label: 'STEM Lab', labelHi: 'STEM लैब' },
      { href: '/pyq', icon: '📄', label: 'PYQ Papers', labelHi: 'पिछले साल के प्रश्न', gradeMin: 9 },
      { href: '/mock-exam', icon: '📋', label: 'Mock Exam', labelHi: 'मॉक परीक्षा', gradeMin: 9 },
    ],
  },
  {
    title: 'Review', titleHi: 'रिव्यू',
    items: [
      { href: '/learn', icon: '📚', label: 'Subjects & Chapters', labelHi: 'विषय और अध्याय' },
      { href: '/study-plan', icon: '📅', label: 'Study Plan', labelHi: 'अध्ययन योजना' },
      { href: '/review', icon: '🔄', label: 'Flashcard Review', labelHi: 'फ्लैशकार्ड रिव्यू' },
    ],
  },
  {
    title: 'Account', titleHi: 'खाता',
    items: [
      { href: '/profile', icon: '👤', label: 'Profile', labelHi: 'प्रोफ़ाइल' },
      { href: '/help', icon: '❓', label: 'Help & Support', labelHi: 'सहायता और सपोर्ट' },
    ],
  },
];

function getCoreTabs(role: UserRole) {
  if (role === 'teacher') {
    const nav = ROLE_CONFIG.teacher.nav;
    return [
      { href: nav[0].href, icon: nav[0].icon, activeIcon: nav[0].icon, label: nav[0].label, labelHi: nav[0].labelHi },
      { href: nav[1].href, icon: nav[1].icon, activeIcon: nav[1].icon, label: nav[1].label, labelHi: nav[1].labelHi },
      { href: nav[2].href, icon: nav[2].icon, activeIcon: nav[2].icon, label: nav[2].label, labelHi: nav[2].labelHi },
      { href: nav[3].href, icon: nav[3].icon, activeIcon: nav[3].icon, label: nav[3].label, labelHi: nav[3].labelHi },
    ];
  }
  if (role === 'guardian') {
    const nav = ROLE_CONFIG.guardian.nav;
    return [
      { href: nav[0].href, icon: nav[0].icon, activeIcon: nav[0].icon, label: nav[0].label, labelHi: nav[0].labelHi },
      { href: nav[1].href, icon: nav[1].icon, activeIcon: nav[1].icon, label: nav[1].label, labelHi: nav[1].labelHi },
      { href: nav[2].href, icon: nav[2].icon, activeIcon: nav[2].icon, label: nav[2].label, labelHi: nav[2].labelHi },
      { href: nav[3].href, icon: nav[3].icon, activeIcon: nav[3].icon, label: nav[3].label, labelHi: nav[3].labelHi },
    ];
  }
  return CORE_TABS; // default student tabs
}

function getMoreItems(role: UserRole) {
  if (role === 'teacher') {
    const nav = ROLE_CONFIG.teacher.nav;
    return nav.slice(4).map(item => ({
      href: item.href, icon: item.icon, label: item.label, labelHi: item.labelHi,
    }));
  }
  if (role === 'guardian') {
    const nav = ROLE_CONFIG.guardian.nav;
    return nav.slice(4).map(item => ({
      href: item.href, icon: item.icon, label: item.label, labelHi: item.labelHi,
    }));
  }
  return MORE_ITEMS; // default student items
}

function getSidebarSections(role: UserRole) {
  if (role === 'teacher') {
    const nav = ROLE_CONFIG.teacher.nav;
    return [
      {
        title: 'Teaching', titleHi: 'शिक्षण',
        items: nav.slice(0, 4).map(n => ({ href: n.href, icon: n.icon, label: n.label, labelHi: n.labelHi })),
      },
      {
        title: 'Account', titleHi: 'खाता',
        items: nav.slice(4).map(n => ({ href: n.href, icon: n.icon, label: n.label, labelHi: n.labelHi })),
      },
    ];
  }
  if (role === 'guardian') {
    const nav = ROLE_CONFIG.guardian.nav;
    return [
      {
        title: 'Family', titleHi: 'परिवार',
        items: nav.slice(0, 4).map(n => ({ href: n.href, icon: n.icon, label: n.label, labelHi: n.labelHi })),
      },
      {
        title: 'Account', titleHi: 'खाता',
        items: nav.slice(4).map(n => ({ href: n.href, icon: n.icon, label: n.label, labelHi: n.labelHi })),
      },
    ];
  }
  return SIDEBAR_SECTIONS; // default student sections
}

export default function BottomNavComponent() {
  const pathname = usePathname();
  const router = useRouter();
  const auth = useAuth();
  const isHi = auth?.isHi ?? false;
  const { roles, activeRole, setActiveRole } = auth;
  const [showMore, setShowMore] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  // Hick's Law: collapse secondary sidebar sections by default to reduce choices
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({ Account: true });
  const moreSheetRef = useRef<HTMLDivElement>(null);

  // Focus management and keyboard support for More sheet
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

  const tabs = getCoreTabs(activeRole);
  const allSidebarSections = getSidebarSections(activeRole);
  // Grade-gated items (PYQ, Mock Exam: grade 9+) are now SHOWN as visibly locked
  // instead of silently hidden — surfaces future value for younger students. See
  // Phase 5B UX mission: "locked state > missing state".
  const studentGrade = parseInt((auth as any)?.student?.grade ?? '6', 10);
  const getItemLock = (item: any) => getItemLockForGrade(item, studentGrade);
  // Phase 5B Surface 3 — show a proactive Upgrade pill in the More sheet
  // for free-plan students. Pro/starter/unlimited never see it.
  const subscriptionPlan = ((auth as any)?.student?.subscription_plan as string | null | undefined) ?? null;
  const showUpgradePill = activeRole === 'student' && (subscriptionPlan === null || subscriptionPlan === 'free');
  // Sidebar SECTION-level gating (rare) still filters the section entirely —
  // a whole-section lockout is too heavy to render as locked items.
  const sidebarSections = allSidebarSections.filter(s => {
    const gMin = (s as any).gradeMin;
    return gMin == null || studentGrade >= gMin;
  });
  // Items are never filtered here; locked state is applied at render time.
  const moreItems = getMoreItems(activeRole);

  // Due-review count for the Review tab badge (SWR-cached — no extra request if dashboard already loaded)
  const { data: dashData } = useDashboardData((auth as any)?.student?.id);
  const dueCount: number = (dashData as any)?.due_count ?? 0;

  // Streak count from snapshot (already loaded in AuthContext — no extra request)
  const streakCount: number = (auth as any)?.snapshot?.current_streak ?? 0;

  const isActive = (href: string) => pathname === href || (href !== '/' && pathname.startsWith(href));
  // isMoreActive should only consider items the user can actually reach.
  const isMoreActive = moreItems.some(m => !getItemLock(m).locked && isActive(m.href));
  const hasMultipleRoles = roles.length > 1;

  const handleRoleSwitch = (role: UserRole) => {
    setActiveRole(role);
    const config = ROLE_CONFIG[role];
    if (config?.homePath) {
      setShowMore(false);
      router.push(config.homePath);
    }
  };

  return (
    <>
      {/* ─── MORE SHEET (mobile overlay) ──────────────── */}
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
              {/* Phase 5B Surface 3 — Upgrade pill (free-plan students only) */}
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
                    data-testid="nav-upgrade-pill"
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
              {/* Role Switcher for multi-role users */}
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
                        onClick={() => handleRoleSwitch(role)}
                        className="w-full flex items-center gap-4 px-4 py-3 rounded-2xl text-left transition-all active:scale-[0.98]"
                        style={{
                          background: isCurrent ? `${cfg.color}12` : 'transparent',
                          color: isCurrent ? cfg.color : 'var(--text-2)',
                        }}
                      >
                        <span className="text-xl w-7 text-center">{cfg.icon}</span>
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

      {/* ─── Mobile Bottom Nav ──────────────── */}
      <nav
        className="bottom-nav-mobile fixed bottom-0 left-0 right-0 z-50 border-t"
        aria-label="Main navigation"
        role="navigation"
        style={{
          background: 'rgba(251, 248, 244, 0.95)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          borderColor: 'var(--border)',
          paddingBottom: 'env(safe-area-inset-bottom, 6px)',
        }}
      >
        {/* Increased padding for Indian thumb-zone ergonomics.
            Research: Bottom nav gets 80% of taps on Indian phones.
            Extra vertical padding prevents accidental taps. */}
        <div className="flex items-end justify-around px-2 pt-2 pb-1">
          {tabs.map((item) => {
            const active = isActive(item.href);

            /* ── Foxy FAB (center) ── only for student role */
            if (activeRole === 'student' && 'isFab' in item && item.isFab) {
              return (
                <button
                  key={item.href}
                  onClick={() => router.push(item.href)}
                  aria-label={`${item.label} - AI Tutor`}
                  aria-current={active ? 'page' : undefined}
                  className="flex flex-col items-center -mt-5 transition-transform active:scale-90"
                >
                  <div
                    className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl shadow-lg"
                    style={{
                      background: active
                        ? 'linear-gradient(135deg, var(--orange), var(--gold))'
                        : 'linear-gradient(135deg, var(--orange), #D84315)',
                      boxShadow: '0 4px 16px rgb(var(--orange-rgb) / 0.35)',
                    }}
                  >
                    {item.icon}
                  </div>
                  <span
                    className="text-[11px] font-bold mt-0.5"
                    style={{ color: active ? 'var(--orange)' : 'var(--text-2)' }}
                  >
                    {isHi ? item.labelHi : item.label}
                  </span>
                </button>
              );
            }

            /* ── Regular tabs ── */
            return (
              <button
                key={item.href}
                onClick={() => router.push(item.href)}
                aria-label={item.label}
                aria-current={active ? 'page' : undefined}
                className="flex flex-col items-center gap-1 min-w-[56px] py-2 transition-all relative"
                style={{ color: active ? 'var(--orange)' : 'var(--text-3)' }}
              >
                <span className="relative inline-block">
                  <span
                    className="text-[22px] leading-none transition-transform block"
                    aria-hidden="true"
                    style={{
                      transform: active ? 'scale(1.15)' : 'scale(1)',
                      filter: active ? 'drop-shadow(0 0 6px rgb(var(--orange-rgb) / 0.35))' : 'none',
                    }}
                  >
                    {active ? item.activeIcon : item.icon}
                  </span>
                  {/* Streak badge on Home tab */}
                  {item.href === '/dashboard' && streakCount > 0 && activeRole === 'student' && (
                    <span
                      className="absolute -top-1.5 -right-2.5 min-w-[20px] h-[16px] rounded-full flex items-center justify-center text-[9px] font-bold px-0.5"
                      style={{ background: '#F59E0B', color: '#fff' }}
                      aria-label={`${streakCount} day streak`}
                    >
                      {streakCount}
                    </span>
                  )}
                </span>
                <span className="text-[11px] font-semibold tracking-wide">
                  {isHi ? item.labelHi : item.label}
                </span>
                {active && (
                  <span className="w-1 h-1 rounded-full" style={{ background: 'var(--orange)' }} />
                )}
              </button>
            );
          })}

          {/* ── More button (replaces hidden items) ── */}
          <button
            onClick={() => setShowMore(!showMore)}
            aria-label="More options"
            aria-expanded={showMore}
            className="flex flex-col items-center gap-0.5 min-w-[56px] py-1.5 transition-all"
            style={{ color: isMoreActive ? 'var(--orange)' : 'var(--text-3)' }}
          >
            <span className="text-[22px] leading-none" aria-hidden="true">&#x2630;</span>
            <span className="text-[11px] font-semibold tracking-wide">{isHi ? 'और' : 'More'}</span>
            {isMoreActive && (
              <span className="w-1 h-1 rounded-full" style={{ background: 'var(--orange)' }} />
            )}
          </button>
        </div>
      </nav>

      {/* ─── Desktop Sidebar ──────────────── */}
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
        {/* Brand */}
        <div>
          <button
            onClick={() => router.push('/dashboard')}
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

          {/* Grouped Nav Sections — secondary sections collapsible (Hick's Law) */}
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
                        onClick={lock.locked ? undefined : () => router.push(item.href)}
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

        {/* Footer */}
        <div className="px-3 pt-4 mt-4 border-t" style={{ borderColor: 'var(--border)' }}>
          {collapsed ? <div className="text-center text-lg">🦊</div> : <div className="text-[11px] text-[var(--text-3)] leading-relaxed">
            <div>Alfanumrik Adaptive Learning OS</div>
            <div className="mt-0.5">Cusiosense Learning India Pvt Ltd</div>
          </div>}
        </div>
      </aside>
    </>
  );
}
