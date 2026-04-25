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

export default function LayoutDeferredChrome() {
  return (
    <>
      <NetworkStatus />
      <MaintenanceBanner />
      <CookieConsent />
    </>
  );
}
