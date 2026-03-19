'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BookOpen, Gamepad2, MessageCircle, FlaskConical, BarChart3 } from 'lucide-react';
import { useStudent } from './StudentProvider';

const NAV = [
  { href: '/dashboard', icon: BookOpen, label: 'Learn', labelHi: 'सीखो' },
  { href: '/quiz', icon: Gamepad2, label: 'Quiz', labelHi: 'क्विज़' },
  { href: '/foxy', icon: MessageCircle, label: 'Foxy', labelHi: 'फॉक्सी' },
  { href: '/simulations', icon: FlaskConical, label: 'Lab', labelHi: 'लैब' },
  { href: '/progress', icon: BarChart3, label: 'Stats', labelHi: 'प्रगति' },
];

export default function BottomNav() {
  const pathname = usePathname();
  const { isHi } = useStudent();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-white/5" style={{ background: 'rgba(30,27,46,0.85)', backdropFilter: 'blur(20px)' }}>
      <div className="max-w-2xl mx-auto flex justify-around py-2">
        {NAV.map(item => {
          const active = pathname === item.href || pathname?.startsWith(item.href + '/');
          return (
            <Link key={item.href} href={item.href} className="flex flex-col items-center gap-0.5 px-3 py-1 transition-all" style={{ color: active ? '#FF6B35' : 'rgba(255,255,255,0.3)' }}>
              <item.icon className="w-5 h-5" />
              <span className="text-[10px] font-bold">{isHi ? item.labelHi : item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
