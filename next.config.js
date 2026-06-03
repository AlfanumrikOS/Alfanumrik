// Validate required env vars for production deployments (not during preview or local dev)
if (process.env.NODE_ENV === 'production' && process.env.VERCEL && process.env.VERCEL_ENV === 'production') {
  const required = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'RAZORPAY_KEY_ID',
    'RAZORPAY_KEY_SECRET',
    'RAZORPAY_WEBHOOK_SECRET',
    'SUPER_ADMIN_SECRET',
  ];
  const optional = [
    'UPSTASH_REDIS_REST_URL',
    'UPSTASH_REDIS_REST_TOKEN',
    'NEXT_PUBLIC_SENTRY_DSN',
  ];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }
  const missingOptional = optional.filter(k => !process.env[k]);
  if (missingOptional.length > 0) {
    console.warn(`[env] Optional env vars not set (using fallbacks): ${missingOptional.join(', ')}`);
  }
}

const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  // PostHog reverse-proxy (Phase 0 of marking-authenticity remediation):
  // recommended PostHog deployment pattern for ad-blocker resilience. Mirrors
  // the Sentry `/monitoring` tunnel approach. The proxy is path-based, NOT a
  // domain redirect, so cookies / referer headers are preserved.
  // See `async rewrites()` below; project region is US (i.posthog.com).
  // Keep `skipTrailingSlashRedirect: true` so PostHog asset URLs that include
  // a trailing slash are not 308-rewritten before they hit the proxy.
  skipTrailingSlashRedirect: true,
  // Tree-shake named imports from heavy libraries. Each entry gets transformed
  // from `import { x, y } from 'pkg'` into per-symbol imports so unused symbols
  // are dropped from the client bundle. P10 budget enforcement.
  experimental: {
    optimizePackageImports: [
      '@sentry/nextjs',
      '@supabase/supabase-js',
      '@supabase/ssr',
      '@upstash/ratelimit',
      '@upstash/redis',
      'react-markdown',
      'remark-gfm',
      'remark-math',
      'rehype-katex',
      'swr',
      'zod',
      'clsx',
      'tailwind-merge',
    ],
  },
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
      { protocol: 'https', hostname: '*.supabase.co' },
      { protocol: 'https', hostname: '*.alfanumrik.com' }, // school logos on tenant subdomains
    ],
  },
  async redirects() {
    return [
      // Study Menu v2 — old routes redirect to their new homes.
      // 301 permanent; preserves bookmarks. After Phase 6.4 (Day 12) deletes
      // the old page files, these redirects are the only thing serving the
      // old URLs. Spec: docs/superpowers/specs/2026-05-20-study-section-consolidation-design.md
      //
      // Note (2026-05-20): the menu flag ff_study_menu_v2 starts at default
      // OFF. Until ops flips it ON in super-admin, the legacy sidebar still
      // shows the old "Review" group — those links 301 to the new pages.
      // That's a transient UX state during soak; once the flag is ON,
      // sidebar and URLs are coherent. The new /refresh and /exam-prep
      // pages stand alone (no flag required to render), so the redirected
      // user lands on a working page either way.
      { source: '/review',     destination: '/refresh?tab=flashcards', permanent: true },
      { source: '/revise',     destination: '/refresh?tab=chapters',   permanent: true },
      { source: '/study-plan', destination: '/exam-prep',              permanent: true },
    ];
  },
  // PostHog reverse-proxy. /ingest/static/* → PostHog static assets (JS SDK,
  // session-recording bundle); /ingest/* → ingestion endpoints (capture,
  // decide, identify). Path-based (not domain-based) to keep cookies +
  // referer in-origin and to avoid CORS preflights for the ingest POST.
  // Marking-Authenticity Phase 0 — sets up infra for Wave 2 PostHog SDK init.
  async rewrites() {
    return [
      {
        source: '/api/py/:path*',
        destination: '/api',
      },
      {
        source: '/ingest/static/:path*',
        destination: 'https://us-assets.i.posthog.com/static/:path*',
      },
      {
        source: '/ingest/:path*',
        destination: 'https://us.i.posthog.com/:path*',
      },
    ];
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'strict-dynamic' https://checkout.razorpay.com https://prod.spline.design",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              "img-src 'self' data: blob: https://*.supabase.co https://lh3.googleusercontent.com",
              // connect-src additions:
              //  - PostHog (us.i.posthog.com, us-assets.i.posthog.com) for the
              //    SDK ingestion + asset fetch path. Same-origin proxy via
              //    /ingest/* covers the primary path; these hosts are listed
              //    so the SDK's direct-host fallback (used when the proxy is
              //    unreachable, e.g. dev) still works without a CSP block.
              //  - fonts.googleapis.com (CSS) + fonts.gstatic.com (the actual
              //    .woff2 files) + cdn.jsdelivr.net for the service worker
              //    (public/sw.js) static-asset cache-first handler.
              //    The main thread fetches fonts via <link> (governed by
              //    style-src/font-src), but the SW's fetch() call is a separate
              //    request that connect-src — NOT font-src — gates. gstatic in
              //    particular must be listed here even though font-src already
              //    allows it, because the SW fetch()ing the woff2 is a
              //    connect-src request; without it the SW's font fetch is
              //    blocked (net::ERR_ABORTED 503) and the SW logs CSP errors
              //    per page load on every navigation (gstatic added 2026-05-24;
              //    googleapis/jsdelivr from 2026-05-20 CEO testing-noise fix).
              "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.ingest.sentry.io https://checkout.razorpay.com https://api.razorpay.com https://prod.spline.design https://us.i.posthog.com https://us-assets.i.posthog.com https://fonts.googleapis.com https://fonts.gstatic.com https://cdn.jsdelivr.net",
              "media-src 'self' blob:",
              "worker-src 'self'",
              "frame-src https://api.razorpay.com https://checkout.razorpay.com",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "upgrade-insecure-requests",
            ].join('; '),
          },
        ],
      },
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        source: '/fonts/(.*)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        source: '/icons/(.*)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' },
        ],
      },
      {
        source: '/manifest.json',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' },
        ],
      },
      {
        source: '/api/v1/health',
        headers: [
          { key: 'Cache-Control', value: 'no-store, max-age=0' },
        ],
      },
      {
        source: '/(dashboard|foxy|quiz|progress|review|study-plan|leaderboard|simulations|profile|notifications|reports|scan|exams|help)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=60, stale-while-revalidate=300' },
        ],
      },
    ];
  },
};

// Only wrap with Sentry in production (Vercel/CI) — avoids OpenTelemetry peer
// dep issues in local dev where Sentry is not configured anyway.
if (process.env.VERCEL || process.env.CI) {
  const { withSentryConfig } = require('@sentry/nextjs');
  module.exports = withSentryConfig(withBundleAnalyzer(nextConfig), {
    silent: true,
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
  }, {
    widenClientFileUpload: true,
    hideSourceMaps: true,
    disableLogger: true,
    tunnelRoute: '/monitoring',
  });
} else {
  module.exports = withBundleAnalyzer(nextConfig);
}
