import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Performance monitoring — 10% in prod, 100% in dev (cost-controlled).
  // Do NOT bump to 1.0 in prod without a cost/quota review — it multiplies
  // Sentry spend by 10x and typically exceeds free-tier transaction limits.
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  environment: process.env.NODE_ENV || 'development',

  // Filter noisy, non-actionable errors (parity with client config).
  ignoreErrors: [
    'ResizeObserver loop',
    'Network request failed',
    'Load failed',
    'ChunkLoadError',
    /^AbortError/,
  ],

  beforeSend(event) {
    // Drop events in non-production environments.
    if (process.env.NODE_ENV !== 'production') return null;
    return event;
  },
});
