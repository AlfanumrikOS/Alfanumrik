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
 * Privacy posture (P13):
 *  - autocapture: true            — see "Autocapture rationale" below
 *  - mask_all_text: true          — autocaptured DOM text is masked at source
 *  - mask_all_element_attributes: true — DOM attributes (alt, value, etc.) masked
 *  - disable_session_recording: true — defer until post P13 masking review
 *  - process_person_profile: 'identified_only' — no anonymous person profiles
 *  - api_host: '/ingest'          — same-origin proxy in next.config.js
 *  - ui_host: 'https://us.posthog.com' — so deep-links from PostHog UI work
 *
 * Autocapture rationale (2026-05-19, mobile-first redesign Phase 1.5):
 *   The ops inventory before the AppShell migration found we had zero
 *   ground-truth data on viewport widths, device class, or which dashboard
 *   surfaces drive clicks. Explicit `track()` events alone can't answer
 *   "what fraction of dashboard taps land on the streak chip vs the
 *   continue card" because every chip would need bespoke instrumentation.
 *
 *   Enabling autocapture closes that gap. To stay P13-safe we pair it with
 *   `mask_all_text: true` + `mask_all_element_attributes: true` so the
 *   payload PostHog ships from the browser is the DOM SHAPE (tag names,
 *   class hierarchy, css-selector path) without any text content or
 *   attribute values. Student names, plan badges, XP totals, streak counts,
 *   subject titles, etc. are masked at source — they never leave the
 *   browser.
 *
 *   The whole autocapture surface is still gated by
 *   `NEXT_PUBLIC_POSTHOG_ENABLED === 'true'`. Setting that env var to
 *   anything other than the literal "true" disables PostHog entirely
 *   (init() short-circuits before the dynamic import). That is the
 *   operational kill-switch for autocapture.
 *
 * Bundle target: this module is small (< 4 kB minified) because posthog-js
 * itself is loaded via dynamic import inside init() — only when the flag is on.
 */

import {
  PERSON_PROPERTY_ALLOWLIST,
  type PostHogEventName,
  type PersonPropertiesAllowlist,
} from './types';

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
      // Init options — keep options minimal; everything not listed defaults
      // to posthog-js's safer choice.
      posthog.init(key, {
        // Same-origin reverse proxy (next.config.js → /ingest/* → us.i.posthog.com).
        // Bypasses ad-blockers on Indian 4G; preserves cookies.
        api_host: '/ingest',
        // So deep-links from the PostHog UI back to events work.
        ui_host: 'https://us.posthog.com',

        // Autocapture is ON to close the dashboard-CTA visibility gap (see
        // header comment "Autocapture rationale"). PII protection is enforced
        // by the next two options so the DOM text + attribute values never
        // leave the browser. The master kill-switch is the
        // NEXT_PUBLIC_POSTHOG_ENABLED env var read by `readKey()` above.
        autocapture: true,
        // P13: mask every text node in autocaptured events. PostHog records
        // the DOM hierarchy + css-selector path but not the visible text —
        // so student names, XP totals, streak counts, plan badges, subject
        // titles, chapter names, foxy chat snippets, etc. are redacted at
        // source. The `track()` API in this file is unaffected; it still
        // accepts explicit, structured properties that we control end-to-end.
        mask_all_text: true,
        // P13: mask DOM attributes (alt, value, placeholder, aria-label,
        // data-*) on autocaptured events too. These can leak the same kind
        // of identity / progress data the visible text would. Defence-in-
        // depth with `mask_all_text`.
        mask_all_element_attributes: true,

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
 * - `userId` is the OPAQUE Supabase auth UUID. PostHog stores it as
 *   `distinct_id`; it never leaves first-party storage and is not joined
 *   with PII. (Architect: if you want a hashed-id surface, swap this to
 *   the `hashUserIdForAnalytics()` flow used in `analytics.ts`.)
 * - `properties` is filtered through `PersonPropertiesAllowlist` — extra
 *   keys (email, phone, full_name) are dropped before the SDK call.
 *
 * Idempotent: repeating with the same `userId` is a no-op.
 */
export function identify(
  userId: string,
  properties?: PersonPropertiesAllowlist | Record<string, unknown>,
): void {
  if (!userId || typeof userId !== 'string') return;
  if (_identifiedId === userId) return;
  _identifiedId = userId;
  const safeProps = filterPersonProperties(properties as Record<string, unknown>);
  void init().then((ph) => {
    if (!ph) return;
    try {
      ph.identify(userId, safeProps);
    } catch {
      // Never throw from analytics.
    }
  });
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
