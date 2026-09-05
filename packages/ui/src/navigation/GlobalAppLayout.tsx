'use client';

import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import OfflineBoundary from '@alfanumrik/ui/offline/v2/OfflineBoundary';

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
// Tier 2 of the same navigation config (768–1023px). Mounted alongside the
// other two and gated purely by CSS, so which tier is visible is a media
// query, not a JS breakpoint listener — no hydration flash, no re-mount on
// resize, and the browser back/forward cache keeps working unchanged.
const TabletNavRail = dynamic(
  () => import('./TabletNavRail').then((m) => m.TabletNavRail),
  { ssr: false },
);

export function GlobalAppLayout({ children }: { children: React.ReactNode }) {
  return <GlobalAppLayoutContent>{children}</GlobalAppLayoutContent>;
}

function GlobalAppLayoutContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { isLoggedIn, activeRole, isHi } = useAuth();

  // Foxy requires edge-to-edge true full screen at tablet/desktop, where its
  // own three-column layout (ConversationManager rail + topic sidebar + chat)
  // needs the full viewport width.
  //
  // 2026-08-24 — this used to suppress ALL nav chrome on /foxy, which was the
  // "no way back" defect: the only exit from Foxy was the header back arrow.
  // Now that `/foxy` is primary slot 3 (CEO-directed IA reversal, see
  // nav-config.ts), a destination that hides the bar the instant you reach it
  // is a trap — and the Foxy slot could never be `aria-current`, because the
  // bar was not in the tree on the one route it names.
  //
  // The MOBILE bottom bar therefore stays mounted on /foxy; the tablet rail
  // and desktop sidebar do not. That split is deliberate, not an oversight:
  //   - <768px the bar is a fixed 60px strip. globals.css gives .foxy-shell
  //     matching bottom clearance in that band so the composer is never
  //     covered, and Foxy's body-lock (position:fixed) means the bar's
  //     scroll-hide never fires — it is a PERSISTENT exit.
  //   - >=768px the rail/sidebar are fixed LEFT gutters, and .app-shell-v2
  //     (Foxy's shell) is not inset by the `.app-shell` margin rules, so they
  //     would overlay the ConversationManager rail. Both components already
  //     self-suppress on /foxy (see DesktopSidebar/TabletNavRail), and those
  //     tiers keep the header back arrow as their exit.
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
                     pathname?.startsWith('/demo');
  // NOT excluded (2026-09-05): '/support' and '/settings'. Both are reachable
  // by a signed-in student -- '/support' is "My Tickets" in the student nav
  // itself (nav-config.ts CORE/MORE + SIDEBAR), and '/settings' is where
  // /help pushes a logged-in user. Excluding them stripped the sidebar AND
  // the mobile bottom bar, so tapping "My Tickets" left a student on a page
  // with no way back. `navEligible` below already requires
  // isLoggedIn && activeRole === 'student', so a signed-out visitor on the
  // public view of these routes still gets no student chrome.

  /** Student on a route the navigation belongs on at all. */
  const navEligible = isLoggedIn && activeRole === 'student' && !isExcluded;
  /** Tablet rail + desktop sidebar — still suppressed on /foxy. */
  const showNav = navEligible && !isFocusedFoxy;
  /** Mobile bottom bar — mounted on /foxy too (see isFocusedFoxy above). */
  const showMobileNav = navEligible;

  // Wave B (ff_offline_v2, default OFF). Deliberately NOT the same condition
  // as `showNav` above: `showNav` excludes Foxy (`isFocusedFoxy`) and a long
  // marketing/other-portal exclusion list, but /foxy and /review are exactly
  // two of the routes the offline boundary review flagged as needing
  // coverage (see OfflineBoundary's own header comment). Scoped to
  // "logged-in student" only — not parent/teacher/admin/public — because
  // OfflineState's copy (downloaded NCERT chapters, queued quiz answers,
  // Foxy) is meaningless outside the student surface, and this component
  // wraps every route from the root layout so an unscoped mount would show
  // it there too once the flag ramps. `OfflineBoundary` itself is a static
  // (non-dynamic) import — it renders `children` untouched whenever the flag
  // is off (or not yet resolved) or the device is online. Since 2026-08-02
  // it is a thin shell that does ONLY the flag check itself; the real
  // useOfflineState()/store.ts logic lives in a next/dynamic({ssr:false})
  // sibling (OfflineBoundaryActive) that OfflineBoundary constructs only
  // once the flag resolves true, so that module never enters the always-on
  // shared bundle this file sits in. See OfflineBoundary's own header
  // comment for why it must stay SSR-safe rather than being ssr:false like
  // the nav components below.
  const isOfflineScoped = isLoggedIn && activeRole === 'student';

  return (
    <>
      {/*
        Binding Navigation: These components are mounted exactly once at the root layout level.
        They persist through all page navigations, preserving states (like sidebar collapse/expand)
        and ensuring ultra-fast route transitions without UI flashing.
      */}
      {showNav && <DesktopSidebar />}
      {showNav && <TabletNavRail />}
      {showMobileNav && <MobileBottomNav />}
      {/*
        The skip-link target has one persistent owner. V3 RoleShell owns the
        semantic <main>, but must not race this id while its presence
        registration settles during hydration.
      */}
      <div id="main-content" tabIndex={-1} data-global-main-content>
        {isOfflineScoped ? <OfflineBoundary isHi={isHi}>{children}</OfflineBoundary> : children}
      </div>
    </>
  );
}
