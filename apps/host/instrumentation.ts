import * as Sentry from '@sentry/nextjs';

/**
 * Next.js server/edge instrumentation hook (@sentry/nextjs v10 convention).
 *
 * HISTORY (P0-1 fix, 2026-08-03): the three `sentry.*.config.ts` files sat at
 * the REPO root while the Next.js project root is `apps/host/`, and no
 * `instrumentation.ts` existed — so Sentry was never initialized in any
 * runtime despite `withSentryConfig` wrapping `next.config.js`. The configs
 * now live in `apps/host/` and are loaded from here per runtime.
 *
 * No-DSN behavior: both configs set `enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN`
 * and pass an undefined `dsn` through, so this whole hook no-ops gracefully
 * when the DSN env var is absent (local dev, forks, CI without secrets).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

/**
 * Next.js `onRequestError` hook — reports errors from nested React Server
 * Components and route handlers to Sentry. The SDK build emits a warning if
 * this export is missing from the instrumentation file. Inherits the P13
 * redaction posture from the per-runtime `beforeSend` hooks (the capture
 * flows through the client initialized by `register()` above).
 */
export const onRequestError = Sentry.captureRequestError;
