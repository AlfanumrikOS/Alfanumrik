'use client';

/**
 * PostHogProvider — initializes the browser SDK once on app mount and
 * fires a `$pageview` on every App Router client-side navigation.
 *
 * Why a separate component (vs init in `<AuthProvider>`)?
 *  - Keeps the PostHog SDK out of the AuthProvider chunk so the auth path
 *    has no analytics dependency at first paint.
 *  - Lets `next/dynamic({ ssr: false })` lazy-load posthog-js without
 *    affecting SSR markup.
 *
 * App Router specifics:
 *  - Next.js 16 App Router does NOT emit pageviews automatically on client
 *    navigation. `usePathname()` / `useSearchParams()` change → we fire
 *    `$pageview` manually. Recommended pattern from PostHog docs (Next.js).
 *
 * No-op when `NEXT_PUBLIC_POSTHOG_ENABLED !== 'true'` or the key is unset
 * (the SDK init in `posthog/client.ts` short-circuits and returns null).
 */

import { useEffect, Suspense } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { init, capturePageview } from '@/lib/posthog/client';

/**
 * Inner component — split out because `useSearchParams()` requires a Suspense
 * boundary in App Router. Without the boundary, the entire route opts into
 * dynamic rendering on the server, which would break our static page generation.
 */
function PageviewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!pathname) return;
    // Build the full URL so PostHog $current_url matches the browser URL.
    const qs = searchParams?.toString();
    const url = qs ? `${pathname}?${qs}` : pathname;
    capturePageview(url);
  }, [pathname, searchParams]);

  return null;
}

export default function PostHogProvider() {
  useEffect(() => {
    // Fire-and-forget: init() short-circuits when the flag is off, so the
    // dynamic import of posthog-js never happens in those builds.
    void init();
  }, []);

  return (
    <Suspense fallback={null}>
      <PageviewTracker />
    </Suspense>
  );
}
