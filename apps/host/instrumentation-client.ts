// Thin deferred Sentry loader (@sentry/nextjs v10 `instrumentation-client.ts`
// convention — replaces the legacy `sentry.client.config.ts`, which Turbopack
// no longer loads).
//
// HISTORY:
//   - P0-1 (2026-08-03): the Sentry client config previously sat at the repo
//     root while the Next.js project root is apps/host/, so it was never
//     bundled and client-side Sentry was silently uninitialized. Moving the
//     full `Sentry.init(...)` here fixed that but pulled the entire browser
//     SDK (~141 kB gzipped incl. Session Replay code) into the first-paint
//     shared bundle: 360.3 kB measured vs CAP_SHARED_KB = 289 kB (P10 gate,
//     scripts/check-bundle-size.mjs).
//   - P10 repair (2026-08-03, this file): the init options moved verbatim to
//     ./sentry-client-init.ts, which is `import()`ed AFTER window load. The
//     dynamic import lands the SDK in an async chunk that rendered HTML never
//     references, so it no longer counts against the shared first-load budget
//     (check-bundle-size.mjs measures chunks referenced by >= 95% of rendered
//     HTML pages). Client-side Sentry stays FUNCTIONAL:
//       1. A bounded pre-init buffer records uncaught errors / unhandled
//          rejections from the very first script tick.
//       2. After `window.load` (idle-scheduled, 3 s timeout) the real init
//          runs — preserving the P13 beforeSend → redactSentryEvent chain,
//          pinned by src/__tests__/sentry/environment-tag-resolution.test.ts.
//       3. Buffered errors are replayed through Sentry.captureException (so
//          they pass through beforeSend redaction) and the buffer listeners
//          are removed.
//     Sentry capture calls elsewhere (logger.ts, ErrorBoundary) made before
//     the deferred init completes no-op safely — the SDK drops events when no
//     client is bound, identical to the pre-P0-1 state.
//
// NOTE: @sentry/nextjs 10.53.1 has no official lazy-load mechanism for the
// npm-installed browser SDK (the "Loader Script" is CDN-only), so this manual
// deferred `import()` is the supported pattern (verified against the
// installed SDK types: `init(options): Client | undefined`,
// `captureRouterTransitionStart(href: string, navigationType: string): void`).

import type * as SentryClient from '@sentry/nextjs';

declare global {
  interface Window {
    /** Bridge for @alfanumrik/lib/sentry-lazy-capture: force-loads and
     * initializes the deferred SDK (memoized). Error boundaries call this so
     * a crash BEFORE the idle-time init still initializes Sentry first —
     * boundary-caught render errors never reach the window 'error' buffer. */
    __alfSentryReady?: () => Promise<void>;
  }
}

const MAX_BUFFERED_ERRORS = 50;

let sdk: typeof SentryClient | null = null;
let loadPromise: Promise<void> | null = null;
const pendingErrors: unknown[] = [];

function bufferError(value: unknown): void {
  if (pendingErrors.length < MAX_BUFFERED_ERRORS) pendingErrors.push(value);
}

const onWindowError = (event: ErrorEvent): void => {
  bufferError(event.error ?? event.message);
};

const onUnhandledRejection = (event: PromiseRejectionEvent): void => {
  bufferError(event.reason);
};

function loadSentry(): Promise<void> {
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const mod = await import('./sentry-client-init');
        sdk = mod.initSentryClient();
        window.removeEventListener('error', onWindowError);
        window.removeEventListener('unhandledrejection', onUnhandledRejection);
        for (const value of pendingErrors.splice(0, pendingErrors.length)) {
          sdk.captureException(value);
        }
      } catch {
        // SDK chunk failed to load (offline / blocked network). Monitoring is
        // fail-open: never break the app for it. The buffer listeners stay
        // installed but the buffer is bounded, so this cannot leak.
      }
    })();
  }
  return loadPromise;
}

function scheduleSentryLoad(): void {
  const kickoff = (): void => {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(() => { void loadSentry(); }, { timeout: 3000 });
    } else {
      window.setTimeout(() => { void loadSentry(); }, 0);
    }
  };
  // instrumentation-client runs before hydration, but guard the already-loaded
  // case anyway (e.g. bfcache restores, late execution).
  if (document.readyState === 'complete') kickoff();
  else window.addEventListener('load', kickoff, { once: true });
}

// instrumentation-client.ts only executes in the browser, but the guard keeps
// this module inert under SSR/test importers.
if (typeof window !== 'undefined') {
  window.addEventListener('error', onWindowError);
  window.addEventListener('unhandledrejection', onUnhandledRejection);
  // Bridge for @alfanumrik/lib/sentry-lazy-capture (error boundaries):
  // lets a pre-idle crash force the deferred init before capturing.
  window.__alfSentryReady = loadSentry;
  scheduleSentryLoad();
}

// Records App Router navigation spans (v10 convention; the SDK build warns if
// an instrumentation-client file exists without this export). Safe forwarder:
// no-ops until the deferred SDK finishes loading, then forwards every call to
// Sentry.captureRouterTransitionStart. (Pre-load transitions are deliberately
// dropped, not queued — replaying a navigation-start after the navigation
// finished would fabricate bogus span timing.)
export function onRouterTransitionStart(href: string, navigationType: string): void {
  sdk?.captureRouterTransitionStart(href, navigationType);
}
