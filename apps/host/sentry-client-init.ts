import * as Sentry from '@sentry/nextjs';
import { redactSentryEvent } from './src/lib/sentry-client-redact';

// Browser-side Sentry init — DEFERRED-LOADED module (P10 fix, 2026-08-03).
//
// HISTORY (P0-1 fix, 2026-08-03): this config previously sat at the repo root
// while the Next.js project root is apps/host/, so it was never bundled and
// client-side Sentry was silently uninitialized. The P0-1 fix moved it into
// apps/host/instrumentation-client.ts (@sentry/nextjs v10 convention), which
// made Sentry functional again but pulled the full browser SDK (~141 kB
// gzipped, including Session Replay code) into the first-paint shared bundle
// — 360.3 kB measured vs the 289 kB CAP_SHARED_KB gate in
// scripts/check-bundle-size.mjs (P10).
//
// FIX: apps/host/instrumentation-client.ts is now a ~1 kB loader that
// dynamically import()s THIS module after window load, keeping the SDK in an
// async chunk outside the first-load HTML script set. The init options below
// are byte-for-byte the ones that lived in instrumentation-client.ts —
// REG-227 (environment-tag resolution) and the P13 beforeSend →
// redactSentryEvent chain are pinned by
// src/__tests__/sentry/environment-tag-resolution.test.ts against this file.
export function initSentryClient(): typeof Sentry {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,

    // Performance monitoring — sample 10% of transactions in production
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

    // Session replay for debugging — 1% of sessions, 100% of errored sessions
    replaysSessionSampleRate: 0.01,
    replaysOnErrorSampleRate: 1.0,

    // Vercel Preview deployments (staging) set NODE_ENV='production' during
    // `next build`, identical to a real production build — VERCEL_ENV is the
    // only value Vercel varies per environment. NEXT_PUBLIC_VERCEL_ENV is the
    // client-readable mirror (VERCEL_ENV itself is not exposed to the browser
    // bundle without the NEXT_PUBLIC_ prefix). Matches the pattern used by
    // src/app/layout.tsx and 35+ other environment-sensitive call sites.
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV || 'development',

    // Filter noisy errors that aren't actionable.
    // 2026-08-03 (P0-1): removed 'Network request failed', 'Load failed',
    // 'ChunkLoadError', and /^AbortError/ from this list — network-error
    // telemetry from real clients (Indian 4G) is exactly what we need to see.
    // Only the genuinely-unactionable ResizeObserver browser quirk remains.
    ignoreErrors: [
      'ResizeObserver loop',
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
  return Sentry;
}
