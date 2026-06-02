'use client';

import { DesktopSidebar } from './DesktopSidebar';
import { MobileBottomNav } from './MobileBottomNav';
import { usePathname } from 'next/navigation';

export function GlobalAppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Foxy requires edge-to-edge true full screen and has its own back navigation
  const isFocusedFoxy = pathname === '/foxy' || pathname?.startsWith('/foxy');

  return (
    <>
      {/* 
        Binding Navigation: These components are mounted exactly once at the root layout level.
        They persist through all page navigations, preserving states (like sidebar collapse/expand)
        and ensuring ultra-fast route transitions without UI flashing.
      */}
      {!isFocusedFoxy && <DesktopSidebar />}
      {!isFocusedFoxy && <MobileBottomNav />}
      {children}
    </>
  );
}
