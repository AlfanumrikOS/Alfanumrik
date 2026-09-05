import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/school-config/manifest
 *
 * Production rewrites `/manifest.json` here to provide tenant-aware branding.
 * Keep this response aligned with `apps/host/public/manifest.json`, the
 * development fallback. The install worker is `/pwa-sw.js`; it is network-only
 * and deliberately never caches app shells, authenticated API responses, or
 * writes. `/sw.js` remains a retirement tombstone for legacy clients.
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
    // Keep a stable app identity across manifest updates.
    id: '/',
    name: isSchool ? `${schoolName} Learning` : 'Alfanumrik',
    short_name: isSchool ? schoolName : 'Alfanumrik',
    description: isSchool
      ? `${schoolName} \u2014 AI-powered adaptive learning for CBSE students`
      : "India's smartest AI-powered adaptive learning platform for CBSE students. Foxy, Bayesian mastery, spaced repetition, gamified learning. Grades 6-12.",
    // Returning users land on the stable dashboard; unauthenticated users are
    // redirected by middleware.
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone' as const,
    orientation: 'portrait' as const,
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
