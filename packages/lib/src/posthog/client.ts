/**
 * PostHog browser SDK singleton wrapper (Marking-Authenticity Wave 2).
 *
 * Why a wrapper?
 *  - Centralize env-var reads (only place NEXT_PUBLIC_POSTHOG_* is referenced).
 *  - Type-safe `track()` constrained to `PostHogEventName` from `./types`.
 *  - Allowlist-based `identify()` — drops any prop outside `PersonPropertiesAllowlist`.
 *  - Lazy dynamic import keeps posthog-js (~50 kB gzip) off the shared chunk
 *    until the flag is on (P10 budget).
 *  - Fail-soft: returns null in dev when key is unset; never throws.
 *
 * Privacy posture (P13 — minors' product, autocapture OFF everywhere):
 *  - autocapture: false           — no implicit DOM/click capture; every event
 *                                   is an explicit, structured `track()` call we
 *                                   control end-to-end. Matches posthog-client.ts
 *                                   and PostHogProvider.tsx (all three inits agree).
 *  - disable_session_recording: true — never record sessions for grades 6-12.
 *  - person_profiles: 'identified_only' — no anonymous person profiles.
 *  - api_host: '/ingest'          — same-origin reverse proxy (next.config.js)
 *                                   that forwards to the EU project
 *                                   (eu.i.posthog.com). Bypasses ad-blockers on
 *                                   Indian 4G; keeps cookies + referer in-origin.
 *  - ui_host: 'https://eu.posthog.com' — EU project 159341, so deep-links from
 *                                   the PostHog UI resolve.
 *
 * Autocapture was ON here historically (paired with mask_all_text) but was
 * turned OFF (2026-07, EU analytics turn-on) so this init matches the other two
 * paths and the product ships zero implicit DOM capture for minors. PostHog
 * remains gated by `NEXT_PUBLIC_POSTHOG_ENABLED === 'true'` — any other value
 * disables it entirely (init() short-circuits before the dynamic import).
 *
 * Bundle target: this module is small (< 4 kB minified) because posthog-js
 * itself is loaded via dynamic import inside init() — only when the flag is on.
 */

import {
  PERSON_PROPERTY_ALLOWLIST,
  type PostHogEventName,
  type PersonPropertiesAllowlist,
} from './types';
// P13: the raw auth UUID must never reach posthog.identify — hash it first,
// reusing the SAME SHA-256/16-hex derivation as analytics.ts + PostHogProvider.
import { hashUserIdForAnalytics } from '../posthog-client';

/**
 * Filter an arbitrary object down to allowlisted person properties.
 * Defense in depth — even if a caller passes extra fields (email, phone,
 * full_name, raw IDs), this strips them before the SDK call. P13.
 *
 * The architect's `PERSON_PROPERTY_ALLOWLIST` in `./types` is the single
 * source of truth for what fields are allowed.
 */
function filterPersonProperties(
  input: Record<string, unknown> | PersonPropertiesAllowlist | undefined | null,
): Record<string, string> {
  if (!input || typeof input !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!PERSON_PROPERTY_ALLOWLIST.has(k)) continue;
    if (v === undefined || v === null) continue;
    if (typeof v !== 'string' || v.length === 0) continue;
    // Hard cap at 256 chars — defense against a buggy caller flooding props.
    out[k] = v.slice(0, 256);
  }
  return out;
}

// We keep posthog-js as a type-only import here so that the static bundle
// doesn't include the SDK. Runtime loading happens via dynamic import in init().
type PosthogModule = typeof import('posthog-js')['default'];

let _instance: PosthogModule | null = null;
let _ready = false;
let _initPromise: Promise<PosthogModule | null> | null = null;
let _identifiedId: string | null = null;

/** Public env-var accessors — the ONLY place NEXT_PUBLIC_POSTHOG_* are read. */
function readKey(): string | null {
  // Master kill-switch: must be the literal string "true".
  if (process.env.NEXT_PUBLIC_POSTHOG_ENABLED !== 'true') return null;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key || typeof key !== 'string' || key.length === 0) return null;
  return key;
}

/**
 * Initialize the PostHog browser SDK exactly once. Subsequent calls are no-ops.
 * Returns the instance (or null when the flag is off / SSR / dynamic import fails).
 *
 * Safe to call multiple times — typically called from `<PostHogProvider>` on mount.
 */
export async function init(): Promise<PosthogModule | null> {
  if (typeof window === 'undefined') return null;
  if (_instance) return _instance;
  if (_initPromise) return _initPromise;

  const key = readKey();
  if (!key) return null;

  _initPromise = (async () => {
    try {
      const mod = await import('posthog-js');
      const posthog = mod.default;
      // NOTE (first-init-wins): posthog-js exposes ONE global singleton. Both
      // this init and posthog-client.ts's ensurePosthog() can call
      // posthog.init() on it in the same session (analytics.ts fans every
      // track() out to both paths). posthog-js keeps the FIRST init and ignores
      // later ones — non-destructive. Both paths now target the SAME EU project
      // (159341) with identical privacy flags (autocapture:false,
      // disable_session_recording:true, person_profiles:'identified_only'), so
      // whichever wins is safe; the only difference is proxy (/ingest here) vs
      // direct EU host (posthog-client.ts), both of which reach the same project.
      //
      // Init options — keep options minimal; everything not listed defaults
      // to posthog-js's safer choice.
      posthog.init(key, {
        // Same-origin reverse proxy (next.config.js → /ingest/* →
        // eu.i.posthog.com / eu-assets.i.posthog.com). Bypasses ad-blockers on
        // Indian 4G; preserves cookies. The proxy targets the EU project so the
        // EU key (project 159341) is neither region-mismatched nor CSP-blocked.
        api_host: '/ingest',
        // So deep-links from the PostHog UI back to events work (EU project).
        ui_host: 'https://eu.posthog.com',

        // P13 (minors' product): autocapture OFF. Every event is an explicit,
        // structured `track()` call we control end-to-end — no implicit DOM or
        // click capture. This matches posthog-client.ts and PostHogProvider.tsx
        // so whichever init wins the posthog-js singleton uses identical, safe
        // config. The master kill-switch remains NEXT_PUBLIC_POSTHOG_ENABLED
        // (read by `readKey()` above).
        autocapture: false,

        // Pageviews are OK — they're useful and PII-free at the URL level.
        // App Router doesn't auto-emit on client-side nav; we wire route changes
        // in <PostHogProvider> to fire $pageview manually.
        capture_pageview: true,
        capture_pageleave: true,

        // Never create person profiles for anonymous traffic.
        // Person rows are only materialized after identify() is called.
        person_profiles: 'identified_only',

        // Defer session recording until P13 masking review (architect Phase 4).
        disable_session_recording: true,

        // Keep distinct_id in localStorage so navigations don't lose identity.
        disable_persistence: false,

        // Honor browser DNT — Indian users on shared devices appreciate this.
        respect_dnt: true,

        // Ad-blocker / tracker-blocker resilience: surveys/recordings disabled
        // anyway, so we don't care about external dependency loading.
        disable_external_dependency_loading: true,

        loaded: () => {
          _ready = true;
        },
      });
      _instance = posthog;
      return posthog;
    } catch {
      // Dynamic import failed (package not installed / network error) — no-op forever.
      return null;
    }
  })();

  return _initPromise;
}

/** True iff posthog-js is loaded and `init()` has resolved. */
export function isReady(): boolean {
  return _ready && _instance !== null;
}

/**
 * The SDK instance (or null when the flag is off / not yet initialized).
 * Prefer `track()` / `identify()` / `reset()` over direct access.
 */
export function posthogClient(): PosthogModule | null {
  return _instance;
}

/**
 * Capture a typed event. The compiler rejects any string outside
 * `PostHogEventName`, so a typo becomes a build error instead of a silent
 * funnel split.
 *
 * Properties are passed through verbatim — the redactor in `analytics.ts`
 * is responsible for stripping PII before this is called.
 *
 * Fire-and-forget: never awaited by callers, never throws.
 */
export function track(
  event: PostHogEventName,
  properties?: Record<string, unknown>,
): void {
  // Initialize on first track() if the provider hasn't already.
  void init().then((ph) => {
    if (!ph) return;
    try {
      ph.capture(event, properties ?? {});
    } catch {
      // Analytics must never break the app.
    }
  });
}

/**
 * Identify the current user with allowlisted person properties.
 *
 * - `userId` MAY be the raw Supabase auth UUID. P13: it is hashed HERE via
 *   `hashUserIdForAnalytics()` (SHA-256, 16-hex-char prefix — the SAME
 *   distinct_id derivation used by analytics.ts and PostHogProvider.tsx)
 *   BEFORE it reaches `posthog.identify`. The raw UUID NEVER leaves the
 *   browser. If Web Crypto is unavailable we skip identify rather than fall
 *   back to the raw id. Hashing internally means every caller of this wrapper
 *   is protected, not just the current AuthContext call site.
 * - `properties` is filtered through `PersonPropertiesAllowlist` — extra
 *   keys (email, phone, full_name) are dropped before the SDK call.
 *
 * Idempotent: repeating with the same `userId` is a no-op. The in-memory dedup
 * key is the raw id, which is only ever compared locally — never transmitted.
 */
export function identify(
  userId: string,
  properties?: PersonPropertiesAllowlist | Record<string, unknown>,
): void {
  if (!userId || typeof userId !== 'string') return;
  if (_identifiedId === userId) return;
  _identifiedId = userId;
  const safeProps = filterPersonProperties(properties as Record<string, unknown>);
  void (async () => {
    // P13: hash BEFORE any SDK call — the raw UUID must never reach PostHog.
    const distinctId = await hashUserIdForAnalytics(userId);
    if (!distinctId) return; // no Web Crypto → skip; never leak the raw id
    const ph = await init();
    if (!ph) return;
    try {
      ph.identify(distinctId, safeProps);
    } catch {
      // Never throw from analytics.
    }
  })();
}

/**
 * Reset distinct_id — call on signout. Without this, a second user signing
 * in on the same browser inherits the first user's PostHog cohort.
 *
 * Also clears the local `_identifiedId` guard so the next identify() call
 * re-fires (rather than being deduped against the previous user).
 */
export function reset(): void {
  _identifiedId = null;
  // No need to await: posthog-js reset is synchronous once instance exists.
  if (_instance) {
    try {
      _instance.reset();
    } catch {
      // Never throw from analytics.
    }
  }
}

/**
 * Manually fire a $pageview. App Router doesn't auto-emit on client-side
 * navigation — `<PostHogProvider>` calls this on `usePathname()` change.
 */
export function capturePageview(url?: string): void {
  if (!_instance) return;
  try {
    _instance.capture('$pageview', url ? { $current_url: url } : undefined);
  } catch {
    // Never throw from analytics.
  }
}
