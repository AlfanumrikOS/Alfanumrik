'use client';

import { usePathname, useRouter } from 'next/navigation';

const NAV = [
  { href: '/dashboard', icon: '⬡', label: 'Home', labelHi: 'होम' },
  { href: '/foxy', icon: '🦊', label: 'Foxy', labelHi: 'फॉक्सी' },
  { href: '/quiz', icon: '⚡', label: 'Quiz', labelHi: 'क्विज़' },
  { href: '/progress', icon: '📈', label: 'Progress', labelHi: 'प्रगति' },
  { href: '/leaderboard', icon: '🏆', label: 'Ranks', labelHi: 'रैंक' },
  { href: '/review', icon: '🔄', label: 'Review', labelHi: 'रिव्यू' },
  { href: '/study-plan', icon: '📅', label: 'Plan', labelHi: 'योजना' },
  { href: '/profile', icon: '👤', label: 'Profile', labelHi: 'प्रोफ़ाइल' },
];

/* Mobile: show first 5 items. Desktop sidebar: show all */
const MOBILE_NAV = NAV.slice(0, 5);

export default function BottomNavComponent() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <>
      {/* ─── Mobile Bottom Nav (< 1024px) ──────────────── */}
      <nav
        className="bottom-nav-mobile fixed bottom-0 left-0 right-0 z-50 border-t"
        style={{
          background: 'rgba(251, 248, 244, 0.92)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderColor: 'var(--border)',
          paddingBottom: 'env(safe-area-inset-bottom, 8px)',
        }}
      >
        <div className="flex items-center justify-around px-2 pt-2 pb-1">
          {MOBILE_NAV.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <button
                key={item.href}
                onClick={() => router.push(item.href)}
                className="flex flex-col items-center gap-0.5 min-w-[52px] py-1 transition-all"
                style={{ color: active ? 'var(--orange)' : 'var(--text-3)' }}
              >
                <span
                  className="text-xl leading-none"
                  style={{
                    filter: active ? 'drop-shadow(0 0 6px rgba(232, 88, 28, 0.4))' : 'none',
                  }}
                >
                  {item.icon}
                </span>
                <span className="text-[10px] font-semibold tracking-wide">{item.label}</span>
                {active && (
                  <span
                    className="w-1 h-1 rounded-full mt-0.5"
                    style={{ background: 'var(--orange)' }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </nav>

      {/* ─── Desktop Sidebar (>= 1024px) ──────────────── */}
      <aside
        className="sidebar-nav flex-col border-r"
        style={{
          background: 'var(--surface-1)',
          borderColor: 'var(--border)',
          width: 'var(--sidebar-width)',
          height: '100dvh',
          position: 'fixed',
          top: 0,
          left: 0,
          zIndex: 50,
          padding: '24px 12px',
          justifyContent: 'space-between',
        }}
      >
        {/* Brand */}
        <div>
          <div className="flex items-center gap-2.5 px-3 mb-8">
            <span className="text-2xl">🦊</span>
            <div>
              <div className="text-base font-bold gradient-text" style={{ fontFamily: 'var(--font-display)' }}>
                Alfanumrik
              </div>
              <div className="text-[10px] text-[var(--text-3)] -mt-0.5">AI Learning OS</div>
            </div>
          </div>

          {/* Nav Items */}
          <div className="space-y-1">
            {NAV.map((item) => {
              const active = pathname.startsWith(item.href);
              return (
                <button
                  key={item.href}
                  onClick={() => router.push(item.href)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all"
                  style={{
                    background: active ? 'rgba(232, 88, 28, 0.08)' : 'transparent',
                    color: active ? 'var(--orange)' : 'var(--text-2)',
                    fontWeight: active ? 600 : 500,
                    fontSize: '14px',
                  }}
                >
                  <span className="text-lg w-6 text-center">{item.icon}</span>
                  <span>{item.label}</span>
                  {active && (
                    <span
                      className="ml-auto w-1.5 h-1.5 rounded-full"
                      style={{ background: 'var(--orange)' }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="px-3 pt-4 border-t" style={{ borderColor: 'var(--border)' }}>
          <div className="text-[11px] text-[var(--text-3)] leading-relaxed">
            <div>Alfanumrik Learning OS v2.0</div>
            <div className="mt-0.5">Built with ❤️ in India</div>
          </div>
        </div>
      </aside>
    </>
  );
}
