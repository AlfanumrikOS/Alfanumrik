'use client';
import { usePathname, useRouter } from 'next/navigation';

const NAV = [
  { href: '/dashboard', icon: '⬡', label: 'Home' },
  { href: '/foxy',      icon: '🦊', label: 'Foxy' },
  { href: '/quiz',      icon: '⚡', label: 'Quiz' },
  { href: '/progress',  icon: '📈', label: 'Progress' },
  { href: '/profile',   icon: '👤', label: 'Profile' },
];

export default function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 glass border-t border-[var(--border)]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 8px)' }}>
      <div className="max-w-lg mx-auto flex items-center justify-around px-2 pt-2 pb-1">
        {NAV.map(item => {
          const active = pathname.startsWith(item.href);
          return (
            <button key={item.href} onClick={() => router.push(item.href)}
              className="flex flex-col items-center gap-0.5 min-w-[52px] py-1 transition-all"
              style={{ color: active ? 'var(--orange)' : 'var(--text-3)' }}>
              <span className="text-xl leading-none" style={{ filter: active ? 'drop-shadow(0 0 8px rgba(255,107,53,0.6))' : 'none' }}>
                {item.icon}
              </span>
              <span className="text-[10px] font-semibold tracking-wide">{item.label}</span>
              {active && <span className="w-1 h-1 rounded-full mt-0.5" style={{ background: 'var(--orange)' }} />}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
