'use client';

import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { ExperiencePresenceProvider, useExperiencePresence } from '../v3/foundations/ExperiencePresence';

// Lazy-load the student navigation chrome off the always-on shared layout
// chunk (P10 shared-JS budget). These two components only render for a
// logged-in student on non-excluded, non-Foxy routes (`showNav` below), so
// their module code — plus the transitive nav-config + dashboard/feature-flag
// SWR wiring they pull — must not sit in the root-layout entry chunk that
// EVERY page (including public marketing + auth pages) downloads at first
// paint. ssr:false is correct here: nav depends on client-resolved auth
// state (useAuth) and renders nothing meaningful during SSR anyway, so there
// is no hydration markup to mismatch. Auth/session/onboarding paths are
// untouched — they never mount these components.
const DesktopSidebar = dynamic(
  () => import('./DesktopSidebar').then((m) => m.DesktopSidebar),
  { ssr: false },
);
const MobileBottomNav = dynamic(
  () => import('./MobileBottomNav').then((m) => m.MobileBottomNav),
  { ssr: false },
);

export function GlobalAppLayout({ children }: { children: React.ReactNode }) {
  return <ExperiencePresenceProvider><GlobalAppLayoutContent>{children}</GlobalAppLayoutContent></ExperiencePresenceProvider>;
}

function GlobalAppLayoutContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { isLoggedIn, activeRole } = useAuth();
  const { active: experienceV3Active } = useExperiencePresence();
  
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
                     pathname?.startsWith('/demo') ||
                     pathname?.startsWith('/settings');

  const showNav = isLoggedIn && activeRole === 'student' && !isFocusedFoxy && !isExcluded && !experienceV3Active;

  return (
    <>
      {/* 
        Binding Navigation: These components are mounted exactly once at the root layout level.
        They persist through all page navigations, preserving states (like sidebar collapse/expand)
        and ensuring ultra-fast route transitions without UI flashing.
      */}
      {showNav && <DesktopSidebar />}
      {showNav && <MobileBottomNav />}
      {/*
        The skip-link target has one persistent owner. V3 RoleShell owns the
        semantic <main>, but must not race this id while its presence
        registration settles during hydration.
      */}
      <div id="main-content" tabIndex={-1} data-global-main-content>{children}</div>
    </>
  );
}
