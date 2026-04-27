import * as Sentry from '@sentry/nextjs';
import { redactSentryEvent } from './src/lib/sentry-client-redact';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Performance monitoring — sample 10% of transactions in production
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  // Session replay for debugging — 1% of sessions, 100% of errored sessions
  replaysSessionSampleRate: 0.01,
  replaysOnErrorSampleRate: 1.0,

  environment: process.env.NODE_ENV || 'development',

  // Filter noisy errors that aren't actionable
  ignoreErrors: [
    'ResizeObserver loop',
    'Network request failed',
    'Load failed',
    'ChunkLoadError',
    /^AbortError/,
  ],

  beforeSend(event) {
    // P13 enforcement — see audit 2026-04-27 finding F1.
    // Redaction is implemented in src/lib/sentry-client-redact.ts so it
    // can be unit-tested without triggering Sentry SDK side effects.
    // Don't send events in development.
    if (process.env.NODE_ENV !== 'production') return null;
    return redactSentryEvent(event);
  },
});
