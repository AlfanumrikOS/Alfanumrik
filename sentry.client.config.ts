import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Performance monitoring — sample all transactions for microservices foundation
  tracesSampleRate: 1.0, // Increased from 0.1 for better tracing during migration

  // Session replay is configured via Sentry Next.js defaults.
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  environment: process.env.NODE_ENV || 'development',

  // Filter noisy errors
  ignoreErrors: [
    'ResizeObserver loop',
    'Network request failed',
    'Load failed',
    'ChunkLoadError',
    /^AbortError/,
  ],

  beforeSend(event) {
    if (process.env.NODE_ENV !== 'production') return null;
    return event;
  },
});
