import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth, type UserRole } from '@/lib/AuthContext';
import { ROLE_CONFIG } from '@/lib/constants';

/* ═══ NAVIGATION ARCHITECTURE ═══
 * Max 4 tabs on mobile bottom nav (cleaner, less cluttered)
 * - Student: Home, Study, Progress, Profile  +  Foxy FAB floating above nav
 * - Teacher: Home, Classes, Reports, Profile
 * - Guardian: Home, Children, Reports, Profile
 * - Desktop sidebar unchanged — groups by function with section headers
 * - Less-used pages accessible from Home or Profile screens
 */

interface NavTab {
  href: string;
  icon: string;
  activeIcon: string;
  label: string;
  labelHi: string;
}

const STUDENT_TABS: NavTab[] = [
  { href: '/dashboard', icon: '🏠', activeIcon: '🏠', label: 'Home', labelHi: 'होम' },
  { href: '/study-plan', icon: '📚', activeIcon: '📚', label: 'Study', labelHi: 'पढ़ाई' },
  { href: '/progress', icon: '📈', activeIcon: '📈', label: 'Progress', labelHi: 'प्रगति' },
  { href: '/profile', icon: '👤', activeIcon: '👤', label: 'Profile', labelHi: 'प्रोफ़ाइल' },
];

const TEACHER_TABS: NavTab[] = [
  { href: '/teacher', icon: '🏠', activeIcon: '🏠', label: 'Home', labelHi: 'होम' },
  { href: '/teacher/classes', icon: '🏫', activeIcon: '🏫', label: 'Classes', labelHi: 'कक्षाएँ' },
  { href: '/teacher/reports', icon: '📊', activeIcon: '📊', label: 'Reports', labelHi: 'रिपोर्ट' },
  { href: '/teacher/profile', icon: '👤', activeIcon: '👤', label: 'Profile', labelHi: 'प्रोफ़ाइल' },
];

const GUARDIAN_TABS: NavTab[] = [
  { href: '/parent', icon: '🏠', activeIcon: '🏠', label: 'Home', labelHi: 'होम' },
  { href: '/parent/children', icon: '👧', activeIcon: '👧', label: 'Children', labelHi: 'बच्चे' },
  { href: '/parent/reports', icon: '📊', activeIcon: '📊', label: 'Reports', labelHi: 'रिपोर्ट' },
  { href: '/parent/profile', icon: '👤', activeIcon: '👤', label: 'Profile', labelHi: 'प्रोफ़ाइल' },
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

function getCoreTabs(role: UserRole): NavTab[] {
  if (role === 'teacher') return TEACHER_TABS;
  if (role === 'guardian') return GUARDIAN_TABS;
  return STUDENT_TABS;
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
  return SIDEBAR_SECTIONS;
}

export default function BottomNavComponent() {
  const pathname = usePathname();
  const router = useRouter();
  const auth = useAuth();
  const isHi = auth?.isHi ?? false;
  const { roles, activeRole } = auth;
  const [collapsed, setCollapsed] = useState(false);

  const tabs = getCoreTabs(activeRole);
  const sidebarSections = getSidebarSections(activeRole);

  const isActive = (href: string) => pathname === href || (href !== '/' && pathname.startsWith(href));
  const foxyActive = isActive('/foxy');

  return (
    <>
      {/* ─── Foxy FAB (floating, students only) ──────────────── */}
      {activeRole === 'student' && (
        <button
          onClick={() => router.push('/foxy')}
          aria-label="Foxy - AI Tutor"
          aria-current={foxyActive ? 'page' : undefined}
          className="bottom-nav-mobile fixed z-[55] transition-transform active:scale-90"
          style={{
            bottom: 'calc(5rem + env(safe-area-inset-bottom, 6px) + 12px)',
            right: '16px',
          }}
        >
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl shadow-lg"
            style={{
              background: foxyActive
                ? 'linear-gradient(135deg, #E8581C, #F5A623)'
                : 'linear-gradient(135deg, #E8581C, #D84315)',
              boxShadow: '0 4px 16px rgba(232,88,28,0.35)',
            }}
          >
            🦊
          </div>
          <span
            className="text-[11px] font-bold mt-0.5 block text-center"
            style={{ color: foxyActive ? 'var(--orange)' : 'var(--text-2)' }}
          >
            {isHi ? 'फॉक्सी' : 'Foxy'}
          </span>
        </button>
      )}

      {/* ─── Mobile Bottom Nav (4 tabs) ──────────────── */}
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
                  aria-hidden="true"
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
                {!collapsed && <div className="text-[11px] font-bold text-[var(--text-3)] uppercase tracking-widest px-3 mb-1.5">
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
