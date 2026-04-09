// Validate required env vars for production deployments (not during local dev)
if (process.env.NODE_ENV === 'production' && process.env.VERCEL) {
  const required = [
    // Supabase
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    // Razorpay
    'RAZORPAY_KEY_ID',
    'RAZORPAY_KEY_SECRET',
    'RAZORPAY_WEBHOOK_SECRET',
    // Admin
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
  // NOTE: eslint.ignoreDuringBuilds removed — Next.js 16 no longer reads it
  // from next.config.js. ESLint runs are controlled by `npm run lint` (CI only).
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
      { protocol: 'https', hostname: '*.supabase.co' },
    ],
  },
  async redirects() {
    return [];
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
              // unsafe-inline required by Next.js for inline scripts/styles.
              // strict-dynamic tells modern browsers to trust scripts loaded
              // by already-trusted scripts, reducing the risk of XSS.
              "script-src 'self' 'unsafe-inline' 'strict-dynamic' https://checkout.razorpay.com",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              "img-src 'self' data: blob: https://*.supabase.co https://lh3.googleusercontent.com",
              "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.ingest.sentry.io https://checkout.razorpay.com https://api.razorpay.com",
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
      // NOTE: /_next/static/(.*) Cache-Control removed — Next.js 16 sets
      // 'public, max-age=31536000, immutable' automatically on hashed assets.
      // Overriding it triggered a build warning and was redundant.
      // Cache fonts aggressively (rarely change)
      {
        source: '/fonts/(.*)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      // Cache icons and manifest (PWA assets)
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
      // API health check — never cache
      {
        source: '/api/v1/health',
        headers: [
          { key: 'Cache-Control', value: 'no-store, max-age=0' },
        ],
      },
      // HTML pages — short cache with stale-while-revalidate for offline resilience
      // Indian mobile users on patchy 4G benefit from cached pages
      {
        source: '/(dashboard|foxy|quiz|progress|review|study-plan|leaderboard|simulations|profile|notifications|reports|scan|exams|help)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=60, stale-while-revalidate=300' },
        ],
      },
    ];
  },
};

const { withSentryConfig } = require('@sentry/nextjs');

module.exports = withSentryConfig(withBundleAnalyzer(nextConfig), {
  // Sentry webpack plugin options
  silent: true, // Suppress build logs
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
}, {
  // Sentry SDK options
  widenClientFileUpload: true,
  hideSourceMaps: true,
  disableLogger: true,
  tunnelRoute: '/monitoring', // Bypass ad-blockers
});
