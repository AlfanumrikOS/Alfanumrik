/**
 * Client-side Sentry event redactor.
 *
 * Extracted from `sentry.client.config.ts` so it can be unit-tested without
 * triggering Sentry SDK side effects (`Sentry.init`) during test imports.
 *
 * P13 enforcement (Data Privacy): no PII in client-side Sentry events.
 * Mirror of the server/edge redaction patterns; keep in sync.
 *
 * Source of truth for the substring redaction list lives here. The Sentry
 * client config simply calls `redactSentryEvent(event)` from inside
 * `beforeSend`.
 */

import { redactPII } from './ops-events-redactor';

// Query string keys whose values must be stripped before they leave the browser.
// Keep in sync with server/edge configs.
export const SENSITIVE_QUERY_KEYS = ['email', 'phone', 'token', 'password', 'key'];

// Context/extra keys whose entire payload must be dropped (not just redacted).
// Match by case-insensitive substring on the key name.
export const SENSITIVE_CONTEXT_KEY_REGEX = /email|phone|token|password|secret|key|cookie|auth/i;

/**
 * Strip query params with sensitive names from a URL string. Preserves the rest.
 * Falls back to the input untouched if URL parsing fails.
 */
export function sanitizeUrl(url: string): string {
  try {
    const u = new URL(url, 'http://placeholder.invalid');
    let mutated = false;
    for (const k of [...u.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEYS.some((s) => k.toLowerCase().includes(s))) {
        u.searchParams.set(k, '[REDACTED]');
        mutated = true;
      }
    }
    if (!mutated) return url;
    // If the original was relative, return path+search only.
    return u.host === 'placeholder.invalid' ? `${u.pathname}${u.search}` : u.toString();
  } catch {
    return url;
  }
}

// Loose typing — we accept the Sentry event shape via duck typing so this
// helper is testable without importing @sentry/types at the use site.
// deno-lint-ignore no-explicit-any
type SentryEventLike = any;

/**
 * Redact a Sentry event in-place (and return it) for client transport.
 *
 * Behavior:
 *   - event.user → keep only opaque `id`
 *   - event.request.headers → strip Authorization, Cookie, Set-Cookie, x-api-key
 *   - event.request.cookies → drop wholesale
 *   - event.request.data (body) → drop wholesale
 *   - event.request.url → sanitize sensitive query params
 *   - event.request.query_string → redactPII when object form
 *   - event.breadcrumbs[*].data → redactPII + sanitizeUrl on url/to/from
 *   - event.breadcrumbs[*].message → sanitize URLs found inside
 *   - event.extra → drop entries whose key matches the sensitive regex,
 *                   redactPII on the rest
 *   - event.contexts → same drop+redact treatment as extra
 *   - event.tags → redactPII (object-shaped redaction)
 */
export function redactSentryEvent(event: SentryEventLike): SentryEventLike {
  if (!event || typeof event !== 'object') return event;

  // Identity: keep only the opaque user.id; drop email/ip/username.
  if (event.user) {
    event.user = { id: event.user.id };
  }

  // Request: scrub auth headers, cookies, body, query strings.
  if (event.request) {
    if (event.request.headers) {
      const h = event.request.headers as Record<string, string>;
      delete h.authorization;
      delete h.Authorization;
      delete h.cookie;
      delete h.Cookie;
      delete h['set-cookie'];
      delete h['Set-Cookie'];
      delete h['x-api-key'];
    }
    delete event.request.cookies;
    // Drop request body wholesale — never safe to ship from a browser.
    delete event.request.data;
    if (typeof event.request.url === 'string') {
      event.request.url = sanitizeUrl(event.request.url);
    }
    if (event.request.query_string && typeof event.request.query_string !== 'string') {
      event.request.query_string = redactPII(event.request.query_string) as typeof event.request.query_string;
    }
  }

  // Walk breadcrumbs — they often carry click targets, navigation URLs,
  // fetch bodies and console args, all of which can leak PII.
  if (Array.isArray(event.breadcrumbs)) {
    event.breadcrumbs = event.breadcrumbs.map((bc: SentryEventLike) => {
      if (!bc) return bc;
      if (bc.data) {
        const scrubbed = redactPII(bc.data) as Record<string, unknown>;
        // Sanitize known URL fields after structural redaction.
        for (const k of ['url', 'to', 'from']) {
          if (typeof scrubbed[k] === 'string') {
            scrubbed[k] = sanitizeUrl(scrubbed[k] as string);
          }
        }
        bc.data = scrubbed;
      }
      if (typeof bc.message === 'string') {
        // Best-effort URL sanitisation for messages that contain a URL.
        bc.message = bc.message.replace(/https?:\/\/\S+/g, (m: string) => sanitizeUrl(m));
      }
      return bc;
    });
  }

  // Drop entire extra/context entries whose key names look sensitive.
  if (event.extra && typeof event.extra === 'object') {
    const filtered: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(event.extra)) {
      if (!SENSITIVE_CONTEXT_KEY_REGEX.test(k)) filtered[k] = v;
    }
    event.extra = redactPII(filtered) as typeof event.extra;
  }

  if (event.contexts && typeof event.contexts === 'object') {
    const filtered: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(event.contexts)) {
      if (!SENSITIVE_CONTEXT_KEY_REGEX.test(k)) filtered[k] = v;
    }
    event.contexts = redactPII(filtered) as typeof event.contexts;
  }

  if (event.tags) event.tags = redactPII(event.tags) as typeof event.tags;

  return event;
}
