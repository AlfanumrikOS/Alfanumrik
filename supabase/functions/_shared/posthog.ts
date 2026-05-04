/**
 * PostHog event capture for Deno Edge Functions.
 *
 * Why a Deno-specific helper?
 *   posthog-node depends on Node built-ins (events, http) that are not
 *   available in the Supabase Edge runtime. We POST raw JSON to the
 *   well-known PostHog `/capture/` endpoint instead — no SDK, no buffering,
 *   no event loop integration. Cost: a single fetch per event (~1-2 KB body).
 *
 * Privacy posture (P13 — Data Privacy):
 *   - `disable_geoip: true` is set on every request so PostHog does NOT
 *     record the caller IP / inferred geo. The Edge Function IP is the
 *     Supabase POP, not the student's, but we still avoid the leak.
 *   - Properties are run through `redactPII` (the same canonical redactor
 *     used by ops_events + Sentry) before being sent. Any field whose key
 *     matches the SENSITIVE_KEYS allowlist is replaced with `[REDACTED]`.
 *   - The PostHog API key is never logged. Failure paths log the response
 *     status only — never the request body or auth header.
 *
 * Reliability posture:
 *   - Fire-and-forget. Capture is awaited inside the helper but ALL errors
 *     are caught + console.warn'd. A capture failure must NEVER bubble up
 *     into the product flow (P12 spirit — analytics failures must not break
 *     student experience).
 *   - 2-second timeout. If PostHog is slow, drop the event and move on.
 *   - When `POSTHOG_PROJECT_API_KEY` is unset, the helper is a no-op. This
 *     keeps local development frictionless and matches the existing
 *     opt-in posture of the client-side PostHog SDK (`posthog-client.ts`).
 *
 * Idempotency:
 *   - PostHog dedupes events by `$insert_id` (set inside `properties`).
 *     Callers MAY pass an `idempotencyKey`; otherwise we synthesise one
 *     from `${event}:${distinctId}:${unixSeconds}`. This means a
 *     retry-storm during a transient PostHog outage still counts as one
 *     event — caller doesn't have to think about it.
 *
 * Anonymous users:
 *   - `capture()` and `identify()` REQUIRE a non-empty distinctId. Anonymous
 *     callers should NOT invoke this helper at all (per the AI engineer
 *     contract: "DO NOT call PostHog for anonymous users — if auth.uid is
 *     null, skip capture"). The helper enforces this defensively: empty
 *     distinctId is a no-op.
 */

import { redactPII } from './redact-pii.ts';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Hard timeout for the capture POST. PostHog ingestion is normally <100 ms. */
const POSTHOG_FETCH_TIMEOUT_MS = 2_000;

/** Default PostHog host (US cloud). Override via POSTHOG_HOST env var. */
const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';

// ─── Internal: env access ────────────────────────────────────────────────────

function getApiKey(): string | null {
  const key = Deno.env.get('POSTHOG_PROJECT_API_KEY');
  if (!key || key.length === 0) return null;
  return key;
}

function getHost(): string {
  const host = Deno.env.get('POSTHOG_HOST');
  if (!host || host.length === 0) return DEFAULT_POSTHOG_HOST;
  // Strip trailing slash to keep URL building deterministic.
  return host.replace(/\/+$/, '');
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Capture a PostHog event from a Deno Edge Function.
 *
 * - `event`: snake_case event name. MUST exist in the canonical event taxonomy
 *   (`src/lib/analytics.ts`). Do not invent ad-hoc names — the parent agent
 *   manages this taxonomy.
 * - `distinctId`: PostHog distinct_id. For students, pass the Supabase auth
 *   UUID (server-side; the client-side helper hashes it for browser-side
 *   capture, but Edge Functions are trusted-side and PostHog accepts the
 *   raw UUID. The same UUID is used by `identify()` so server- and
 *   client-side captures coalesce on one person). DO NOT pass null /
 *   empty — anonymous callers must not invoke this.
 * - `properties`: event properties. PII is redacted before send. NEVER pass
 *   message text, question text, options, or explanations.
 * - `idempotencyKey`: optional dedup key. If omitted, derived from
 *   `${event}:${distinctId}:${unixSeconds}`.
 *
 * Always resolves — never throws. Failures are logged as console.warn.
 */
export async function capture(
  event: string,
  distinctId: string,
  properties: Record<string, unknown> = {},
  idempotencyKey?: string,
): Promise<void> {
  const apiKey = getApiKey();
  if (!apiKey) return; // PostHog not configured in this environment — no-op.

  if (!event || typeof event !== 'string') {
    console.warn('[posthog] capture called with invalid event name');
    return;
  }
  if (!distinctId || typeof distinctId !== 'string') {
    // Anonymous — caller should have skipped. Defensive no-op.
    return;
  }

  const insertId =
    idempotencyKey && idempotencyKey.length > 0
      ? idempotencyKey
      : `${event}:${distinctId}:${Math.floor(Date.now() / 1000)}`;

  // P13: redact PII keys (email, phone, token, etc.) before send.
  const safeProperties = redactPII(properties) as Record<string, unknown>;

  const body = {
    api_key: apiKey,
    event,
    distinct_id: distinctId,
    properties: {
      ...safeProperties,
      $insert_id: insertId,
      // Marks events as originating from a server-side capture path.
      // Mirrors posthog-node behaviour so server events sort distinctly
      // from browser events in PostHog.
      $lib: 'alfanumrik-edge',
    },
    timestamp: new Date().toISOString(),
    // P13: don't auto-collect IP-derived geo. The POP IP is not the
    // student's, but PostHog would still write it onto the person profile.
    disable_geoip: true,
  };

  await postCapture(body, getHost());
}

/**
 * Identify a user to PostHog. Sets person properties without emitting an
 * event. Idempotent — call once per session start; repeat calls overwrite
 * the same properties.
 *
 * - `distinctId`: same UUID convention as `capture()`.
 * - `properties`: person properties. PII redacted before send.
 *
 * Always resolves — never throws.
 */
export async function identify(
  distinctId: string,
  properties: Record<string, unknown> = {},
): Promise<void> {
  const apiKey = getApiKey();
  if (!apiKey) return;
  if (!distinctId || typeof distinctId !== 'string') return;

  const safeProperties = redactPII(properties) as Record<string, unknown>;

  // PostHog $identify is captured as an event with $set merging the
  // properties onto the person profile. This matches the on-the-wire
  // shape used by posthog-node and posthog-js.
  const body = {
    api_key: apiKey,
    event: '$identify',
    distinct_id: distinctId,
    properties: {
      $set: safeProperties,
      $insert_id: `identify:${distinctId}:${Math.floor(Date.now() / 1000)}`,
      $lib: 'alfanumrik-edge',
    },
    timestamp: new Date().toISOString(),
    disable_geoip: true,
  };

  await postCapture(body, getHost());
}

// ─── Internal: HTTP ──────────────────────────────────────────────────────────

async function postCapture(body: unknown, host: string): Promise<void> {
  const url = `${host}/capture/`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), POSTHOG_FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      // Status only — never log the body (would leak api_key on a verbose
      // proxy bounce, and properties even after redaction may carry
      // operational signal we don't want in console logs).
      console.warn(`[posthog] capture failed: HTTP ${res.status}`);
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      console.warn(`[posthog] capture timed out (${POSTHOG_FETCH_TIMEOUT_MS}ms)`);
      return;
    }
    // Network / DNS / TLS — drop, do not throw.
    console.warn(
      `[posthog] capture threw: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * True iff the helper would actually attempt a network call. Useful for
 * skipping expensive event-property construction in hot paths when PostHog
 * is not configured.
 */
export function isPosthogEnabled(): boolean {
  return getApiKey() !== null;
}
