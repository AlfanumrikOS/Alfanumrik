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

  environment: process.env.NODE_ENV || 'development',

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

    // P13: Strip PII before any payload leaves the server.
    // Identity: keep only the opaque user.id; drop email/ip/username.
    if (event.user) {
      event.user = { id: event.user.id };
    }

    // Request: scrub auth headers and cookies; redact body/query.
    if (event.request) {
      if (event.request.headers) {
        const h = event.request.headers as Record<string, string>;
        delete h.authorization;
        delete h.Authorization;
        delete h.cookie;
        delete h.Cookie;
        // Set-Cookie can leak the session cookie back through Sentry. Parity
        // with sentry.client.config.ts. Added 2026-05-05 (D7 follow-up #4).
        delete h['set-cookie'];
        delete h['Set-Cookie'];
        delete h['x-api-key'];
      }
      delete event.request.cookies;
      if (event.request.data) {
        event.request.data = redactPII(event.request.data) as typeof event.request.data;
      }
      // request.url often carries auth tokens / verification codes / email
      // params (e.g. /auth/callback?code=…&email=…). Strip those before the
      // event leaves the server. Parity with sentry.client.config.ts.
      // Added 2026-05-05 (D7 follow-up #4 — Section 11 + Section 7.1 claim).
      if (typeof event.request.url === 'string') {
        event.request.url = sanitizeUrl(event.request.url);
      }
      if (event.request.query_string && typeof event.request.query_string !== 'string') {
        event.request.query_string = redactPII(event.request.query_string) as typeof event.request.query_string;
      }
    }

    // Walk breadcrumbs — server-side breadcrumbs are typically sparse but
    // can include outbound HTTP URLs (Razorpay, Anthropic) with sensitive
    // params or fetch bodies. Mirror the client redactor's posture.
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

    // Walk extra + contexts for any nested PII.
    if (event.extra) event.extra = redactPII(event.extra) as typeof event.extra;
    if (event.contexts) event.contexts = redactPII(event.contexts) as typeof event.contexts;
    if (event.tags) event.tags = redactPII(event.tags) as typeof event.tags;

    return event;
  },
});
