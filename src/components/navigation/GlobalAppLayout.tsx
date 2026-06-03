'use client';

import { DesktopSidebar } from './DesktopSidebar';
import { MobileBottomNav } from './MobileBottomNav';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';

export function GlobalAppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { isLoggedIn, activeRole } = useAuth();
  
  // Foxy requires edge-to-edge true full screen and has its own back navigation
  const isFocusedFoxy = pathname === '/foxy' || pathname?.startsWith('/foxy');

  const isExcluded = pathname === '/' ||
                     pathname?.startsWith('/welcome') ||
                     pathname?.startsWith('/login') ||
                     pathname?.startsWith('/onboarding') ||
                     pathname?.startsWith('/super-admin') ||
                     pathname?.startsWith('/internal/admin') ||
                     pathname?.startsWith('/admin') ||
                     pathname?.startsWith('/school-admin') ||
                     pathname?.startsWith('/parent') ||
                     pathname?.startsWith('/teacher') ||
                     pathname?.startsWith('/about') ||
                     pathname?.startsWith('/pricing') ||
                     pathname?.startsWith('/contact') ||
                     pathname?.startsWith('/terms') ||
                     pathname?.startsWith('/privacy') ||
                     pathname?.startsWith('/refunds') ||
                     pathname?.startsWith('/careers') ||
                     pathname?.startsWith('/press') ||
                     pathname?.startsWith('/research') ||
                     pathname?.startsWith('/help') ||
                     pathname?.startsWith('/for-parents') ||
                     pathname?.startsWith('/for-schools') ||
                     pathname?.startsWith('/for-teachers') ||
                     pathname?.startsWith('/product') ||
                     pathname?.startsWith('/schools') ||
                     pathname?.startsWith('/security') ||
                     pathname?.startsWith('/support') ||
                     pathname?.startsWith('/demo');

  const showNav = isLoggedIn && activeRole === 'student' && !isFocusedFoxy && !isExcluded;

  return (
    <>
      {/* 
        Binding Navigation: These components are mounted exactly once at the root layout level.
        They persist through all page navigations, preserving states (like sidebar collapse/expand)
        and ensuring ultra-fast route transitions without UI flashing.
      */}
      {showNav && <DesktopSidebar />}
      {showNav && <MobileBottomNav />}
      {children}
    </>
  );
}
