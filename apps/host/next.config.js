const path = require('path');

// Validate required env vars for production deployments (not during preview or local dev).
// Guard against running validation at build time — secrets are only injected at ECS task start.
// NEXT_PHASE is 'phase-production-build' during `next build`; undefined at runtime.
const isProductionBuild = process.env.NEXT_PHASE === 'phase-production-build';
const isProductionRuntime =
  !isProductionBuild &&
  process.env.NODE_ENV === 'production' &&
  // VERCEL_ENV is set by Vercel on production deploys.
  // DEPLOY_TARGET='production' is the AWS/ECS runtime flag — set in the ECS task definition,
  // never at build time, so secrets are always present when this guard runs on ECS.
  (process.env.VERCEL_ENV === 'production' || process.env.DEPLOY_TARGET === 'production');
if (isProductionRuntime) {
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
const repoRoot = path.join(__dirname, '../..');

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@alfanumrik/ui', '@alfanumrik/lib'],
  // Bundle a self-contained Node server into .next/standalone/ so the image
  // can run on AWS ECS Fargate (or any container runtime) without needing a
  // full node_modules install. Public assets and static chunks are copied
  // separately in the Dockerfile.
  output: 'standalone',
  // P2-2 fix (2026-09-03 launch audit). `typescript.ignoreBuildErrors: true`
  // used to live here as a workaround for a Next.js 16 bug: the build-time
  // type-checker's generated `.next/types/validator.ts` imported
  // `../../src/app/<route>/layout.js` for every App Router layout (the
  // actual files are `.tsx`), producing ~500 spurious TS2307 errors and
  // killing the build before `routes-manifest.json` was written. Live-
  // verified this bug is gone as of Next 16.3.1 (currently pinned): a local
  // `next build` with `ignoreBuildErrors` unset (the Next default, i.e.
  // build-time type-checking ON) completed successfully end-to-end,
  // producing the full route manifest. Removed the workaround entirely so
  // the build's own type-checker is a real gate again, alongside `tsc
  // --noEmit` (`npm run type-check`, the pre-existing CI gate this
  // workaround's comment always pointed to as the "real" check). If this
  // regresses on a future Next.js upgrade, the original workaround is in
  // git history (`git log -p -- apps/host/next.config.js`).
  // The active npm workspace is apps/host, but node_modules is hoisted at the
  // repository root. Trace from the monorepo root so standalone Docker images
  // include runtime packages such as next.
  outputFileTracingRoot: repoRoot,
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  // Keep Turbopack and output tracing on the same root. The repo lives inside
  // nested worktrees, so set the root explicitly instead of relying on Next's
  // inference.
  turbopack: {
    root: repoRoot,
  },
  // Expose Vercel's deployment environment to client code as
  // NEXT_PUBLIC_VERCEL_ENV. VERCEL_ENV is a Vercel-injected build var that is
  // 'production' on the production deploy, 'preview' on PR preview deploys, and
  // 'development' on `vercel dev`. It is NOT secret (it carries no token, key,
  // or PII — only the deploy tier string). The frontend uses this to
  // auto-enable the cosmic redesign on previews only, while production
  // visibility stays gated by the ff_cosmic_redesign_v1 feature flag (default
  // OFF). Falls back to '' for local `npm run dev` where VERCEL_ENV is unset.
  env: {
    NEXT_PUBLIC_VERCEL_ENV: process.env.VERCEL_ENV ?? '',
  },
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
    // Run webpack compilation in a separate worker process (2026-07-17,
    // Vercel preview OOM fix). Next.js AUTO-DISABLES webpackBuildWorker
    // whenever a custom webpack function is present — and withSentryConfig
    // (bottom of this file) injects one on Vercel/CI — unless the experiment
    // is explicitly opted in here. Without the worker, the entire app
    // (280+ routes, mermaid, recharts, katex) compiles inside the single
    // build process and exceeds the 8 GB preview build machine → SIGKILL
    // (dpl_D3QM6VDKj1u1f7GTwaBEzoF1n6QZ, every preview since #1307).
    // @sentry/nextjs supports webpackBuildWorker since 7.57.0 (installed:
    // 10.53.1; verified locally with the Sentry-wrapped CI build path).
    //
    // Kill switch RENAMED to NEXT_DISABLE_WEBPACK_BUILD_WORKER_V2 (2026-07-17):
    // the legacy name NEXT_DISABLE_WEBPACK_BUILD_WORKER=1 — a 2026-07-10
    // LOCAL-ONLY Windows workaround (see engineering-audit/
    // PRODUCT_READINESS_EXECUTION_2026-07-09.md #36) — leaked into the Vercel
    // project env, forced the worker OFF despite the #1313 fix, and froze
    // production on an old build after 3 consecutive OOM deploy failures.
    // The legacy name is now DELIBERATELY IGNORED by this config so the
    // leaked var is inert without needing dashboard access.
    // Rollback (env-only, no code revert): set
    // NEXT_DISABLE_WEBPACK_BUILD_WORKER_V2=1 in the Vercel project env.
    // Operator cleanup: delete BOTH vars (legacy and, if ever set, _V2) from
    // the Vercel env when convenient. Runbook: docs/runbooks/SRE_RUNBOOK.md §13.
    webpackBuildWorker: process.env.NEXT_DISABLE_WEBPACK_BUILD_WORKER_V2 !== '1',
    ...(process.env.NEXT_WEBPACK_MEMORY_OPTIMIZATIONS === '1'
      ? { webpackMemoryOptimizations: true }
      : {}),
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

      // Legacy /mock-exam runtime retirement (Phase 5 track A, 2026-08-11).
      // The old page ran a 3-hour CBSE paper entirely in React state and wrote
      // nothing to the database (no attempt row, no responses, no XP, no
      // mastery). The runtime and its results/layout files are deleted; the
      // successor catalogue at /exams/mock persists real attempts via the
      // start_mock_test_attempt RPC. These redirects exist purely so old
      // bookmarks, notification deep links and the retired practice alias
      // still resolve instead of 404ing. 301 permanent; preserves bookmarks.
      // Pinned by apps/host/src/__tests__/app/mock-exam-retirement.test.ts.
      { source: '/mock-exam',           destination: '/exams/mock', permanent: true },
      { source: '/mock-exam/:path*',    destination: '/exams/mock', permanent: true },
      { source: '/practice/exam/mock',  destination: '/exams/mock', permanent: true },
    ];
  },
  // PostHog reverse-proxy → EU project 159341 (eu.i.posthog.com). /ingest/static/*
  // → PostHog static assets (JS SDK, session-recording bundle); /ingest/* →
  // ingestion endpoints (capture, decide, identify). Path-based (not
  // domain-based) to keep cookies + referer in-origin and to avoid CORS
  // preflights for the ingest POST. Targets the EU host so the EU key's region
  // matches (US endpoints would reject/mis-route an EU project key).
  async rewrites() {
    return [
      {
        source: '/api/py/:path*',
        destination: '/api',
      },
      {
        source: '/ingest/static/:path*',
        destination: 'https://eu-assets.i.posthog.com/static/:path*',
      },
      {
        source: '/ingest/:path*',
        destination: 'https://eu.i.posthog.com/:path*',
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
            // P2-3 fix (2026-09-03 launch audit) — LIVE CAUTION: this header
            // is NOT what actually reaches the browser for almost any route.
            // `apps/host/src/proxy.ts`'s middleware runs on nearly every
            // request (its own config.matcher excludes only a few static
            // paths) and OVERWRITES this exact header on the way out —
            // verified live via `curl -D- https://alfanumrik.com/`. Keep this
            // value textually in sync with proxy.ts's copy (which carries the
            // full rationale, including why 'strict-dynamic' is deliberately
            // absent); this next.config.js copy only actually applies to the
            // matcher-excluded static-asset paths.
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' https://checkout.razorpay.com https://prod.spline.design",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              "img-src 'self' data: blob: https://*.supabase.co https://lh3.googleusercontent.com",
              // connect-src additions:
              //  - PostHog EU project 159341 (eu.i.posthog.com,
              //    eu-assets.i.posthog.com) for the SDK ingestion + asset fetch
              //    path. Same-origin proxy via /ingest/* covers the primary
              //    path; these hosts are listed so the SDK's direct-host
              //    fallback (used when the proxy is unreachable, e.g. dev) still
              //    works without a CSP block. US hosts removed — the project is
              //    EU-only, so no consumer needs us.i.posthog.com.
              //  - fonts.googleapis.com (CSS), fonts.gstatic.com (font files),
              //    and cdn.jsdelivr.net remain for current main-thread runtime
              //    consumers. public/sw.js is now a no-fetch retirement
              //    tombstone and does not require connect-src access.
              "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.ingest.sentry.io https://checkout.razorpay.com https://api.razorpay.com https://prod.spline.design https://eu.i.posthog.com https://eu-assets.i.posthog.com https://fonts.googleapis.com https://fonts.gstatic.com https://cdn.jsdelivr.net",
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
        // P2-11 fix (2026-09-02 launch audit): these are all authenticated,
        // per-student-personalized pages — `public` told every intermediary
        // cache (a school computer lab's proxy, an ISP cache) it's safe to
        // serve the SAME cached response to a different user, and invited
        // browser back-forward-cache reuse across a login/logout on a
        // shared machine. `private` keeps the identical max-age/stale-
        // while-revalidate caching benefit, scoped to the requesting
        // browser's own cache only — matching the convention already used
        // for equivalent authenticated content elsewhere in this codebase
        // (school-admin reports API: 'private, max-age=60, stale-while-
        // revalidate=120').
        source: '/(dashboard|foxy|quiz|progress|review|study-plan|leaderboard|simulations|profile|notifications|reports|scan|exams|help)',
        headers: [
          { key: 'Cache-Control', value: 'private, max-age=60, stale-while-revalidate=300' },
        ],
      },
    ];
  },
};

// Only wrap with Sentry in production (Vercel/CI/ECS) — avoids OpenTelemetry peer
// dep issues in local dev where Sentry is not configured anyway.
// Also wraps in AWS ECS (DEPLOY_TARGET=production set by task definition)
if (process.env.VERCEL || process.env.CI || process.env.DEPLOY_TARGET === 'production') {
  const { withSentryConfig } = require('@sentry/nextjs');
  // @sentry/nextjs v10 signature is withSentryConfig(nextConfig, sentryBuildOptions)
  // — TWO arguments (verified against the installed 10.53.1:
  // build/cjs/config/withSentryConfig/index.js). This call previously used the
  // legacy v7 THREE-argument shape, so the third object (widenClientFileUpload,
  // hideSourceMaps, disableLogger, tunnelRoute) was silently ignored. Options
  // are now merged into the single v10 options object. `hideSourceMaps` no
  // longer exists in v10 — its intent is covered by the v10 default
  // `sourcemaps.deleteSourcemapsAfterUpload: true` (maps are removed from the
  // build output after upload).
  module.exports = withSentryConfig(withBundleAnalyzer(nextConfig), {
    silent: true,
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    widenClientFileUpload: true,
    disableLogger: true,
    tunnelRoute: '/monitoring',
    // P10: strip SDK code we never use from the client bundle. The client init
    // (apps/host/sentry-client-init.ts) sets replay sample rates but never
    // registers replayIntegration, so Replay never activates — excluding the
    // replay iframe/Shadow-DOM recorders is safe. excludeTracing is
    // deliberately NOT set (tracesSampleRate is in use). Supported flags
    // verified against 10.53.1 build/types/config/types.d.ts
    // (bundleSizeOptimizations — no feedback exclusion exists in this
    // version; excludeReplayWorker is only for manually-hosted workers).
    bundleSizeOptimizations: {
      excludeDebugStatements: true,
      excludeReplayShadowDom: true,
      excludeReplayIframe: true,
    },
  });
} else {
  module.exports = withBundleAnalyzer(nextConfig);
}
