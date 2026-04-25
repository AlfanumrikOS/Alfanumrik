import * as Sentry from '@sentry/nextjs';
import { redactPII } from './src/lib/ops-events-redactor';

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
        delete h['x-api-key'];
      }
      delete event.request.cookies;
      if (event.request.data) {
        event.request.data = redactPII(event.request.data) as typeof event.request.data;
      }
      if (event.request.query_string && typeof event.request.query_string !== 'string') {
        event.request.query_string = redactPII(event.request.query_string) as typeof event.request.query_string;
      }
    }

    if (event.extra) event.extra = redactPII(event.extra) as typeof event.extra;
    if (event.contexts) event.contexts = redactPII(event.contexts) as typeof event.contexts;
    if (event.tags) event.tags = redactPII(event.tags) as typeof event.tags;

    return event;
  },
});
