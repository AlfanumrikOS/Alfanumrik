import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/school-config/manifest
 *
 * THIS IS THE MANIFEST PRODUCTION ACTUALLY SERVES. `apps/host/src/proxy.ts`
 * rewrites every `/manifest.json` request here, so `apps/host/public/manifest.json`
 * is only a local/dev fallback. Any manifest change must be made in BOTH files
 * or it will not reach users.
 *
 * Returns a manifest customized per school tenant: for a B2B school the name,
 * colours, and logo come from the x-school-* headers the middleware injects
 * after resolving the subdomain. For B2C users it returns Alfanumrik defaults.
 *
 * INSTALLABILITY — READ BEFORE EDITING (2026-08-09):
 * Alfanumrik is deliberately NOT an installable PWA. No service worker is
 * registered anywhere in the app; `apps/host/public/sw.js` is a retirement
 * tombstone with no fetch handler that unregisters itself, and
 * `ServiceWorkerCleanup` (packages/lib/src/RegisterSW.tsx) actively removes
 * legacy registrations. With no worker there is no install prompt, and an
 * app-window display mode would only produce a chrome-less dead end (no
 * reload, no back) the first time a student's connection drops.
 *
 * So this manifest is metadata-only: `display: 'browser'`, no `orientation`,
 * no `screenshots`. Do NOT restore those fields as a drive-by — they are the
 * install-advertising surface and belong to a real offline project. See the
 * header of apps/host/public/sw.js and section 8 of
 * docs/runbooks/pwa-stale-service-worker-recovery.md.
 *
 * No auth required -- PWA manifest is public.
 * No authorizeRequest() needed -- read-only config from middleware headers.
 */
export async function GET(request: NextRequest) {
  const schoolSlug = request.headers.get('x-school-slug') || '';
  const schoolName = schoolSlug
    ? decodeURIComponent(request.headers.get('x-school-name') || 'School')
    : '';
  const primaryColor = request.headers.get('x-school-primary-color') || '#7C3AED';
  const logoUrl = request.headers.get('x-school-logo') || '';

  const isSchool = Boolean(schoolSlug);

  // Build icon entries. For schools with a custom logo, use it for both sizes.
  // For default Alfanumrik, use the standard SVG icons from public/.
  const icons = isSchool && logoUrl
    ? [
        { src: logoUrl, sizes: '192x192', type: 'image/png', purpose: 'any' as const },
        { src: logoUrl, sizes: '512x512', type: 'image/png', purpose: 'any maskable' as const },
      ]
    : [
        { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' as const },
        { src: '/icon-192x192.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any' as const },
        { src: '/icon-512x512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' as const },
      ];

  const manifest = {
    // `id` is pinned to '/' \u2014 the value browsers previously derived from the
    // old `start_url: '/'`. Keeping it explicit means changing start_url does
    // not re-identify the app for any device that added it to a home screen
    // before 2026-08-09.
    id: '/',
    name: isSchool ? `${schoolName} Learning` : 'Alfanumrik',
    short_name: isSchool ? schoolName : 'Alfanumrik',
    description: isSchool
      ? `${schoolName} \u2014 AI-powered adaptive learning for CBSE students`
      : "India's smartest AI-powered adaptive learning platform for CBSE students. Foxy, Bayesian mastery, spaced repetition, gamified learning. Grades 6-12.",
    // A home-screen shortcut belongs to a returning user, so it must not land
    // on the marketing home page. /dashboard is the stable target: it is not
    // feature-flagged, and /today falls back to it when ff_today_home_v1 is
    // off. Logged-out users are redirected to auth by the middleware.
    start_url: '/dashboard',
    scope: '/',
    // Metadata-only, not app-like. See the installability note in the file
    // header before changing this, adding `orientation`, or adding
    // `screenshots` \u2014 all three are install-advertising surfaces the app
    // cannot currently deliver.
    display: 'browser' as const,
    background_color: '#FFFFFF',
    theme_color: isSchool ? primaryColor : '#FBF8F4',
    categories: ['education'],
    lang: 'en-IN',
    dir: 'ltr' as const,
    icons,
  };

  return NextResponse.json(manifest, {
    headers: {
      'Content-Type': 'application/manifest+json',
      // 1 hour cache for school manifests, 5 min for default
      // Schools change branding infrequently; align with tenant cache TTL
      'Cache-Control': isSchool
        ? 'public, max-age=3600, s-maxage=3600'
        : 'public, max-age=300, s-maxage=300',
    },
  });
}
