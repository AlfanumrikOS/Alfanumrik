/**
 * Lazy, drop-in `captureException` for CLIENT error surfaces (P10, 2026-08-03).
 *
 * WHY THIS EXISTS
 * ================
 * The P0-1 Sentry-initialization fix moved the browser `Sentry.init` into the
 * bundled app, and the P10 repair deferred that init behind a dynamic import
 * (see apps/host/instrumentation-client.ts). But every error boundary
 * (packages/ui/src/ErrorBoundary.tsx, SectionErrorBoundary.tsx, the root
 * app/error.tsx + app/global-error.tsx, and ~18 per-route error.tsx files)
 * still imported `captureException` STATICALLY from '@sentry/nextjs', which
 * kept ~14.7 kB gzipped of @sentry/core in the first-paint shared bundle and
 * pushed shared first-load JS over the CAP_SHARED_KB gate in
 * scripts/check-bundle-size.mjs.
 *
 * This module exports the SAME NAME and SAME call signature as the SDK's
 * `captureException`, so converting a call site is a one-line import swap:
 *
 *   - import { captureException } from '@sentry/nextjs';
 *   + import { captureException } from '@alfanumrik/lib/sentry-lazy-capture';
 *
 * HOW IT STAYS CORRECT
 * =====================
 *  - It first awaits `window.__alfSentryReady()` — the bridge installed by
 *    apps/host/instrumentation-client.ts — which force-loads AND initializes
 *    the deferred SDK. This matters for errors thrown before the idle-time
 *    init: React error boundaries swallow render errors (they never reach the
 *    window 'error' listener buffer), so without this bridge a crash in the
 *    first seconds would be silently dropped by an uninitialized SDK.
 *  - The dynamic `import('@sentry/nextjs')` resolves to the same webpack
 *    module instances the deferred init used, so events flow through the
 *    initialized client and its P13 `beforeSend` → redactSentryEvent chain
 *    (pinned by src/__tests__/sentry/environment-tag-resolution.test.ts).
 *  - Monitoring is fail-open: any load/capture failure is swallowed — error
 *    UI must never break because telemetry did.
 *
 * Client surfaces only: under SSR (or any non-browser import) this is a no-op
 * — error boundaries and error.tsx effects only fire in the browser anyway.
 */

// Type-only import — erased at compile time, adds nothing to the bundle.
import type { captureException as SentryCaptureException } from '@sentry/nextjs';

declare global {
  interface Window {
    /** Installed by apps/host/instrumentation-client.ts: force-loads and
     * initializes the deferred Sentry SDK, memoized. */
    __alfSentryReady?: () => Promise<void>;
  }
}

export function captureException(...args: Parameters<typeof SentryCaptureException>): void {
  if (typeof window === 'undefined') return;
  const ready = window.__alfSentryReady ? window.__alfSentryReady() : Promise.resolve();
  ready
    .then(() => import('@sentry/nextjs'))
    .then((Sentry) => {
      Sentry.captureException(...args);
    })
    .catch(() => {
      // Fail-open: never let telemetry failures surface in error UI.
    });
}
