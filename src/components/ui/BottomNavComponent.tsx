import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth, type UserRole } from '@/lib/AuthContext';
import { ROLE_CONFIG } from '@/lib/constants';

/* ═══ NAVIGATION ARCHITECTURE ═══
 * Research-backed: Duolingo 5-tab model (the gold standard for EdTech)
 * - 5 bottom tabs max on mobile (thumb-zone optimized)
 * - Center position = primary action (Foxy AI tutor)
 * - "More" sheet for secondary features (no hidden features)
 * - Desktop sidebar groups by function with section headers
 * - Every page reachable in ≤ 2 taps
 */

const CORE_TABS = [
  { href: '/dashboard', icon: '🏠', activeIcon: '🏠', label: 'Home', labelHi: 'होम' },
  { href: '/study-plan', icon: '📚', activeIcon: '📚', label: 'Learn', labelHi: 'सीखो' },
  { href: '/foxy', icon: '🦊', activeIcon: '🦊', label: 'Foxy', labelHi: 'फॉक्सी', isFab: true },
  { href: '/quiz', icon: '⚡', activeIcon: '⚡', label: 'Quiz', labelHi: 'क्विज़' },
  { href: '/profile', icon: '👤', activeIcon: '👤', label: 'Me', labelHi: 'मैं' },
];

const MORE_ITEMS = [
  { href: '/simulations', icon: '🔬', label: 'Interactive Lab', labelHi: 'इंटरैक्टिव लैब' },
  { href: '/leaderboard', icon: '🏆', label: 'Rankings & Compete', labelHi: 'रैंकिंग और प्रतियोगिता' },
  { href: '/progress', icon: '📈', label: 'My Progress', labelHi: 'मेरी प्रगति' },
  { href: '/review', icon: '🔄', label: 'Flashcard Review', labelHi: 'फ्लैशकार्ड रिव्यू' },
  { href: '/notifications', icon: '🔔', label: 'Notifications', labelHi: 'सूचनाएँ' },
  { href: '/help', icon: '❓', label: 'Help & Support', labelHi: 'सहायता और सपोर्ट' },
];

const SIDEBAR_SECTIONS = [
  {
    title: 'Main', titleHi: 'मुख्य',
    items: [
      { href: '/dashboard', icon: '🏠', label: 'Home', labelHi: 'होम' },
      { href: '/foxy', icon: '🦊', label: 'Foxy AI Tutor', labelHi: 'फॉक्सी AI ट्यूटर' },
    ],
  },
  {
    title: 'Study', titleHi: 'पढ़ाई',
    items: [
      { href: '/study-plan', icon: '📚', label: 'Study Plan', labelHi: 'अध्ययन योजना' },
      { href: '/simulations', icon: '🔬', label: 'Interactive Lab', labelHi: 'इंटरैक्टिव लैब' },
      { href: '/quiz', icon: '⚡', label: 'Quick Quiz', labelHi: 'क्विज़' },
      { href: '/review', icon: '🔄', label: 'Flashcard Review', labelHi: 'फ्लैशकार्ड रिव्यू' },
    ],
  },
  {
    title: 'Track', titleHi: 'ट्रैक',
    items: [
      { href: '/progress', icon: '📈', label: 'My Progress', labelHi: 'मेरी प्रगति' },
      { href: '/leaderboard', icon: '🏆', label: 'Rankings', labelHi: 'रैंकिंग' },
      { href: '/notifications', icon: '🔔', label: 'Notifications', labelHi: 'सूचनाएँ' },
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

  const tabs = getCoreTabs(activeRole);
  const moreItems = getMoreItems(activeRole);
  const sidebarSections = getSidebarSections(activeRole);

  const isActive = (href: string) => pathname === href || (href !== '/' && pathname.startsWith(href));
  const isMoreActive = moreItems.some(m => isActive(m.href));
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
                const active = isActive(item.href);
                return (
                  <button
                    key={item.href}
                    onClick={() => { setShowMore(false); router.push(item.href); }}
                    className="w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl text-left transition-all active:scale-[0.98]"
                    style={{
                      background: active ? 'rgba(232,88,28,0.08)' : 'transparent',
                      color: active ? 'var(--orange)' : 'var(--text-2)',
                    }}
                  >
                    <span className="text-xl w-7 text-center">{item.icon}</span>
                    <span className="text-sm font-semibold">{isHi ? item.labelHi : item.label}</span>
                    {active && <span className="ml-auto w-1.5 h-1.5 rounded-full" style={{ background: 'var(--orange)' }} />}
                  </button>
                );
              })}
              {/* Role Switcher for multi-role users */}
              {hasMultipleRoles && (
                <div className="pt-2 mt-2" style={{ borderTop: '1px solid var(--border)' }}>
                  <p className="text-[10px] font-bold text-[var(--text-3)] uppercase tracking-widest px-4 mb-1.5">
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
                        ? 'linear-gradient(135deg, #E8581C, #F5A623)'
                        : 'linear-gradient(135deg, #E8581C, #D84315)',
                      boxShadow: '0 4px 16px rgba(232,88,28,0.35)',
                    }}
                  >
                    {item.icon}
                  </div>
                  <span
                    className="text-[10px] font-bold mt-0.5"
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
                className="flex flex-col items-center gap-0.5 min-w-[56px] py-1.5 transition-all"
                style={{ color: active ? 'var(--orange)' : 'var(--text-3)' }}
              >
                <span
                  className="text-[22px] leading-none transition-transform"
                  style={{
                    transform: active ? 'scale(1.15)' : 'scale(1)',
                    filter: active ? 'drop-shadow(0 0 6px rgba(232, 88, 28, 0.35))' : 'none',
                  }}
                >
                  {active ? item.activeIcon : item.icon}
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
            <span className="text-[22px] leading-none" aria-hidden="true">☰</span>
            <span className="text-[10px] font-semibold tracking-wide">{isHi ? 'और' : 'More'}</span>
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
              <div className="text-[10px] text-[var(--text-3)] -mt-0.5">AI Learning OS</div>
            </div>}
          </button>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="w-full flex items-center justify-center py-2 mb-2 rounded-lg transition-all hover:bg-[var(--surface-2)]"
            style={{ color: 'var(--text-3)' }}
            title={collapsed ? 'Expand menu' : 'Collapse menu'}
          >
            <span style={{ fontSize: 12 }}>{collapsed ? '\u00BB' : '\u00AB'}</span>
          </button>

          {/* Grouped Nav Sections */}
          <div className="space-y-5">
            {sidebarSections.map(section => (
              <div key={section.title}>
                {!collapsed && <div className="text-[10px] font-bold text-[var(--text-3)] uppercase tracking-widest px-3 mb-1.5">
                  {isHi ? section.titleHi : section.title}
                </div>}
                <div className="space-y-0.5">
                  {section.items.map(item => {
                    const active = isActive(item.href);
                    const isFoxy = item.href === '/foxy';
                    return (
                      <button
                        key={item.href}
                        onClick={() => router.push(item.href)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all"
                        style={{
                          background: active
                            ? isFoxy ? 'rgba(232,88,28,0.12)' : 'rgba(232,88,28,0.06)'
                            : 'transparent',
                          color: active ? 'var(--orange)' : 'var(--text-2)',
                          fontWeight: active ? 600 : 500,
                          fontSize: '14px',
                        }}
                      >
                        <span className="text-lg w-6 text-center">{item.icon}</span>
                        {!collapsed && <span>{isHi ? item.labelHi : item.label}</span>}
                        {active && !collapsed && (
                          <span className="ml-auto w-1.5 h-1.5 rounded-full" style={{ background: 'var(--orange)' }} />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
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
