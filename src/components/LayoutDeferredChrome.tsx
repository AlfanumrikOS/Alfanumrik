'use client';

/**
 * Client-only wrapper that defers non-critical layout chrome off the shared
 * JS chunk. None of these components render anything on first paint:
 *
 *  - CookieConsent: brings in @vercel/analytics + @vercel/speed-insights;
 *    only renders the consent banner when consent === 'pending', and only
 *    mounts <Analytics /> + <SpeedInsights /> after consent === 'all'.
 *  - MaintenanceBanner: only visible when a maintenance flag is on in DB.
 *  - NetworkStatus: only visible when navigator is offline.
 *  - PostHogProvider: initializes PostHog browser SDK + App Router pageview
 *    tracker. Was statically imported in app/layout.tsx (D5 launch-readiness
 *    fix 2026-05-05) — moved here so its module code (useEffect/usePathname/
 *    useSearchParams/Suspense + dynamic-import of posthog-js) is split off
 *    the layout entry chunk and loaded after first paint. The provider
 *    itself returns null markup, so SSR is unaffected by ssr: false.
 *
 * Lazy-loading them removes the @vercel/* SDK + a couple of Supabase
 * realtime subscriptions from the route-level shared bundle and shifts
 * them to a deferred client chunk that loads after first paint. P10
 * shared-JS budget hardening.
 */

import dynamic from 'next/dynamic';

const CookieConsent = dynamic(() => import('./CookieConsent'), { ssr: false });
const MaintenanceBanner = dynamic(() => import('./MaintenanceBanner'), { ssr: false });
const NetworkStatus = dynamic(() => import('./NetworkStatus'), { ssr: false });
const PostHogProvider = dynamic(() => import('./PostHogProvider'), { ssr: false });

export default function LayoutDeferredChrome() {
  return (
    <>
      <NetworkStatus />
      <MaintenanceBanner />
      <CookieConsent />
      <PostHogProvider />
    </>
  );
}
