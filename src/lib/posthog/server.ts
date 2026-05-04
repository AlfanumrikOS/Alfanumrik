/**
 * PostHog server-side singleton (posthog-node v4).
 *
 * Wave 2 of the marking-authenticity remediation. Provides a fail-soft
 * `capture()` for server-side events (quiz grading, payment lifecycle, etc.)
 *
 * Serverless safety
 *   Vercel functions are cold-started and torn down per-request. Without
 *   `flushAt: 1` + `flushInterval: 0` + an explicit `await client.flush()`,
 *   posthog-node would batch events in memory and they would be dropped when
 *   the lambda terminates. We trade batching efficiency for at-least-once
 *   delivery — that is the correct tradeoff for low-volume server events.
 *
 * Privacy posture (P13)
 *   - `disableGeoip: true` — never auto-collect IP-derived geolocation.
 *   - All event properties pass through `redactPII()` (extends the base
 *     logger redactor with payment + identity keys; see EVENT_PROPERTY_PII_KEYS).
 *   - All `identify()` person properties pass through the allowlist filter
 *     (PERSON_PROPERTY_ALLOWLIST) — anything not in the allowlist is dropped.
 *
 * Fail-soft contract
 *   - If env not set → returns `null` from `getClient()`. `capture()` no-ops.
 *   - If posthog-node throws → swallowed. Analytics never breaks the app.
 *   - Mirrors the Sentry posture: telemetry is best-effort, never load-bearing.
 */

import { redactPII as baseRedactPII } from '@/lib/ops-events-redactor';
import { logger } from '@/lib/logger';
import {
  PERSON_PROPERTY_ALLOWLIST,
  EVENT_PROPERTY_PII_KEYS,
  type PostHogEventName,
  type EventPayload,
  type BaseEventProperties,
  type PersonPropertiesAllowlist,
} from '@/lib/posthog/types';

// ─── Lazy import — posthog-node is in package.json but we never want a
// missing-module error to take down the API route. Mirrors posthog-client.ts.
type PostHogClient = {
  capture: (args: {
    distinctId: string;
    event: string;
    properties?: Record<string, unknown>;
    disableGeoip?: boolean;
  }) => void;
  identify: (args: { distinctId: string; properties?: Record<string, unknown> }) => void;
  flush: () => Promise<void>;
  shutdown: () => Promise<void>;
};

type PostHogCtor = new (
  apiKey: string,
  options: {
    host?: string;
    flushAt?: number;
    flushInterval?: number;
    disableGeoip?: boolean;
    requestTimeout?: number;
  },
) => PostHogClient;

let _client: PostHogClient | null = null;
let _initFailed = false; // sticky — don't keep retrying the import

function getApiKey(): string | null {
  // Prefer server-only key; fall back to public key (same value, different env name).
  const key = process.env.POSTHOG_PROJECT_API_KEY || process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key || typeof key !== 'string' || key.length === 0) return null;
  return key;
}

function getHost(): string {
  return process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';
}

function getEnvironment(): string {
  return process.env.VERCEL_ENV || process.env.NODE_ENV || 'development';
}

function getAppVersion(): string {
  // Set by Next.js from package.json at build/runtime.
  return process.env.npm_package_version || process.env.NEXT_PUBLIC_APP_VERSION || 'unknown';
}

/**
 * Get (or lazily create) the PostHog server client. Returns null when:
 *   - The API key env is unset (disabled in this environment).
 *   - posthog-node fails to import (missing module).
 *   - Initialization throws.
 *
 * Idempotent: subsequent calls return the cached client.
 */
function getClient(): PostHogClient | null {
  if (_client) return _client;
  if (_initFailed) return null;

  const apiKey = getApiKey();
  if (!apiKey) return null;

  try {
    // Synchronous require so capture() can stay synchronous-feeling.
    // posthog-node ships CJS — Node.js require is the supported path.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('posthog-node') as { PostHog: PostHogCtor };
    if (!mod?.PostHog) {
      _initFailed = true;
      return null;
    }
    _client = new mod.PostHog(apiKey, {
      host: getHost(),
      // Serverless safety — capture and flush per request; do not batch.
      // Without these, events disappear on lambda termination.
      flushAt: 1,
      flushInterval: 0,
      // P13 — never auto-collect IP geolocation.
      disableGeoip: true,
      // Match Vercel's 30s function ceiling but fail fast at 5s so a slow
      // PostHog ingest endpoint never wedges a payment webhook.
      requestTimeout: 5_000,
    });
    return _client;
  } catch (err) {
    _initFailed = true;
    // Use console directly — logger goes through Sentry which itself depends
    // on similar telemetry plumbing. Keep this dependency-free.
    console.warn('[posthog/server] init failed; capture() will no-op:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * Redact PII from an arbitrary properties object.
 *
 * Layered enforcement:
 *   1. Base redactor from src/lib/ops-events-redactor.ts (password, token,
 *      email, phone, api_key, authorization, cookie, etc.) — handles the
 *      common shape across logger + Sentry + ops_events.
 *   2. Extra PostHog-specific keys (EVENT_PROPERTY_PII_KEYS) — adds
 *      razorpay_signature, card_number, card_cvv, full_name, school_name,
 *      ip_address, user_agent, etc. These are not in the base set because
 *      they are payment + browser surface specific.
 *
 * Behaviour:
 *   - Returns a new object; never mutates input.
 *   - Recursively walks nested objects + arrays (delegated to base redactor).
 *   - Handles circular references via the base redactor's WeakSet.
 *   - Replaces values with the literal string '[REDACTED]'.
 *
 * Tests: see src/__tests__/lib/posthog/server-redactor.test.ts (Wave 3 task).
 */
export function redactPII(obj: Record<string, unknown>): Record<string, unknown> {
  // First pass: base redactor handles the common keys + circular safety.
  const baseRedacted = baseRedactPII(obj) as Record<string, unknown>;
  // Second pass: walk one more time to redact PostHog-specific keys.
  return walkAndRedactExtras(baseRedacted) as Record<string, unknown>;
}

function walkAndRedactExtras(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (seen.has(value as object)) return '[Circular]';
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((v) => walkAndRedactExtras(v, seen));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (EVENT_PROPERTY_PII_KEYS.has(k.toLowerCase())) {
      out[k] = '[REDACTED]';
    } else {
      out[k] = walkAndRedactExtras(v, seen);
    }
  }
  return out;
}

/**
 * Filter a person-properties object to the allowlist (P13).
 * Drops any key not in PERSON_PROPERTY_ALLOWLIST. Keys ARE NOT replaced with
 * '[REDACTED]' — they are entirely removed, because PostHog person properties
 * persist on the profile and a leaked key would survive forever.
 */
function filterPersonProperties(props: PersonPropertiesAllowlist): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (PERSON_PROPERTY_ALLOWLIST.has(k)) {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Read the current request's request-id for cross-system correlation.
 * Returns undefined when not called from a Next.js request context (e.g.
 * unit tests, cron jobs). The middleware sets `x-request-id` on every
 * incoming request.
 */
async function readRequestId(): Promise<string | undefined> {
  try {
    const { headers } = await import('next/headers');
    const h = await headers();
    return h.get('x-request-id') ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Capture a server-side event.
 *
 * @param event       Canonical event name from PostHogEventName union.
 * @param distinctId  Stable per-user id. Prefer the hashed UUID prefix; the
 *                    raw Supabase auth UUID is acceptable server-side because
 *                    server logs are not P13-restricted (logger redacts before
 *                    they leave the server). See src/lib/posthog-client.ts for
 *                    the client-side hashing rule.
 * @param properties  Event-specific payload merged with BaseEventProperties.
 * @param idempotencyKey
 *                    Optional — sets PostHog's $insert_id so duplicate calls
 *                    (e.g. webhook retries) are deduped on the ingest side.
 *                    When omitted, defaults to `${event}:${distinctId}:${unix_seconds}`
 *                    which dedupes accidental double-fires within the same second.
 *
 * Always awaits `flush()` so the event makes it out before the lambda terminates.
 * Never throws — wraps everything in try/catch and swallows errors.
 */
export async function capture<E extends PostHogEventName>(
  event: E,
  distinctId: string,
  properties: BaseEventProperties & EventPayload<E>,
  idempotencyKey?: string,
): Promise<void> {
  const client = getClient();
  if (!client) return;
  if (!distinctId) return;

  try {
    const requestId = properties.request_id ?? (await readRequestId());
    const merged: Record<string, unknown> = {
      ...properties,
      request_id: requestId,
      environment: properties.environment ?? getEnvironment(),
      app_version: properties.app_version ?? getAppVersion(),
    };

    const safeProps = redactPII(merged);
    // PostHog's native dedup field. If two captures share $insert_id, only one
    // is kept in PostHog. This is the correct hook for Razorpay webhook retries.
    safeProps['$insert_id'] =
      idempotencyKey ?? `${event}:${distinctId}:${Math.floor(Date.now() / 1000)}`;

    client.capture({
      distinctId,
      event,
      properties: safeProps,
      disableGeoip: true,
    });

    // Critical for serverless — without this, events drop on cold-start lambda
    // termination. The 5s requestTimeout above bounds the worst case.
    await client.flush();
  } catch (err) {
    // Telemetry failures must never break business logic. Log once and move on.
    try {
      logger.warn('posthog.capture failed', {
        event,
        error: err instanceof Error ? err.message : String(err),
      });
    } catch {
      // Even the logger fell over — accept the loss.
    }
  }
}

/**
 * Set/update person properties for a user. Filters through the allowlist —
 * anything not in PERSON_PROPERTY_ALLOWLIST is silently dropped (no [REDACTED]
 * marker, because person profiles persist forever).
 */
export async function identify(
  distinctId: string,
  properties: PersonPropertiesAllowlist,
): Promise<void> {
  const client = getClient();
  if (!client) return;
  if (!distinctId) return;

  try {
    const filtered = filterPersonProperties(properties);
    if (Object.keys(filtered).length === 0) return;

    client.identify({ distinctId, properties: filtered });
    await client.flush();
  } catch (err) {
    try {
      logger.warn('posthog.identify failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    } catch { /* noop */ }
  }
}

/**
 * Flush + close the client. Not strictly needed in Vercel serverless (each
 * function instance is short-lived), but useful for long-running scripts
 * (forensic-quiz-lookup, daily-cron) and tests.
 */
export async function shutdown(): Promise<void> {
  if (!_client) return;
  try {
    await _client.shutdown();
  } catch {
    /* swallow */
  } finally {
    _client = null;
  }
}

/** Test-only: reset the singleton so a test can re-init with new env vars. */
export function __resetForTesting(): void {
  _client = null;
  _initFailed = false;
}

/** True iff posthog-node is configured and likely usable. Cheap probe. */
export function isPostHogServerEnabled(): boolean {
  return getApiKey() !== null;
}
