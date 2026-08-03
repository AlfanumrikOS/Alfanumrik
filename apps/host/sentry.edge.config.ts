import * as Sentry from '@sentry/nextjs';
import { redactPII } from './src/lib/ops-events-redactor';
import { sanitizeUrl } from './src/lib/sentry-client-redact';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Performance monitoring — 10% in prod, 100% in dev (cost-controlled).
  // Do NOT bump to 1.0 in prod without a cost/quota review — it multiplies
  // Sentry spend by 10x and typically exceeds free-tier transaction limits.
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  // Vercel Preview deployments (staging) set NODE_ENV='production' during
  // `next build`, identical to a real production build — VERCEL_ENV is the
  // only value Vercel varies per environment. VERCEL_ENV (non-NEXT_PUBLIC) is
  // available in the Edge runtime the same way it is in Node.js server
  // functions — this file never executes in the browser. Matches the
  // pattern used by src/lib/feature-flags.ts and 35+ other server-side
  // environment-sensitive call sites.
  environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',

  // Filter noisy, non-actionable errors (parity with client config).
  ignoreErrors: [
    'ResizeObserver loop',
    'Network request failed',
    'Load failed',
    'ChunkLoadError',
    /^AbortError/,
    'Non-Error promise rejection captured',
  ],

  beforeSend(event) {
    // Drop events in non-production environments.
    if (process.env.NODE_ENV !== 'production') return null;

    // P13: Edge runtime payload scrubbing — same contract as server config.
    if (event.user) {
      event.user = { id: event.user.id };
    }

    if (event.request) {
      if (event.request.headers) {
        const h = event.request.headers as Record<string, string>;
        delete h.authorization;
        delete h.Authorization;
        delete h.cookie;
        delete h.Cookie;
        // Set-Cookie parity with server + client configs. Added 2026-05-05
        // (D7 follow-up #4 — Section 11 PII-redaction claim).
        delete h['set-cookie'];
        delete h['Set-Cookie'];
        delete h['x-api-key'];
      }
      delete event.request.cookies;
      if (event.request.data) {
        event.request.data = redactPII(event.request.data) as typeof event.request.data;
      }
      // Strip sensitive query params from request.url. Edge runtime sees
      // /auth/callback, /api/foxy etc. — both can carry tokens.
      if (typeof event.request.url === 'string') {
        event.request.url = sanitizeUrl(event.request.url);
      }
      if (event.request.query_string && typeof event.request.query_string !== 'string') {
        event.request.query_string = redactPII(event.request.query_string) as typeof event.request.query_string;
      }
    }

    // Walk breadcrumbs (parity with server config).
    if (Array.isArray(event.breadcrumbs)) {
      event.breadcrumbs = event.breadcrumbs.map((bc) => {
        if (!bc) return bc;
        if (bc.data) {
          const scrubbed = redactPII(bc.data) as Record<string, unknown>;
          for (const k of ['url', 'to', 'from']) {
            if (typeof scrubbed[k] === 'string') {
              scrubbed[k] = sanitizeUrl(scrubbed[k] as string);
            }
          }
          bc.data = scrubbed as typeof bc.data;
        }
        if (typeof bc.message === 'string') {
          bc.message = bc.message.replace(/https?:\/\/\S+/g, (m: string) => sanitizeUrl(m));
        }
        return bc;
      });
    }

    if (event.extra) event.extra = redactPII(event.extra) as typeof event.extra;
    if (event.contexts) event.contexts = redactPII(event.contexts) as typeof event.contexts;
    if (event.tags) event.tags = redactPII(event.tags) as typeof event.tags;

    return event;
  },
});
