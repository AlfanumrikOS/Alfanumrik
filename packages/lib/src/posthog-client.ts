/**
 * PostHog SDK initialization (client-side only).
 *
 * Why: Vercel Analytics gives page-level + custom events, but lacks cohort/
 * retention/funnel analysis. PostHog fills that gap. We dispatch every
 * `track()` call to BOTH (Vercel + PostHog) so legacy dashboards keep working
 * while we migrate cohort analysis to PostHog.
 *
 * Privacy posture:
 *  - Bails out unless `NEXT_PUBLIC_POSTHOG_ENABLED === 'true'` AND a key is
 *    set. Defaults to OFF — opt-in only.
 *  - `identify()` MUST be called with a hashed user ID (16-hex-char SHA-256
 *    prefix), never the raw Supabase auth UUID. P13 (no PII in client logs).
 *  - Dynamic import keeps posthog-js out of the main bundle until first use.
 *  - All errors are swallowed: analytics must never break the app.
 */

// We intentionally avoid a static import of posthog-js so that:
//  (a) the bundle stays small until the flag is on, and
//  (b) the build doesn't fail if the package isn't installed.
type PosthogModule = typeof import('posthog-js')['default'];

let posthogInstance: PosthogModule | null = null;
let initPromise: Promise<PosthogModule | null> | null = null;
let identifiedHash: string | null = null;

function getKey(): string | null {
  // Bail unless the env-flag is explicitly on. This keeps PostHog truly opt-in.
  const enabled = process.env.NEXT_PUBLIC_POSTHOG_ENABLED === 'true';
  if (!enabled) return null;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key || typeof key !== 'string' || key.length === 0) return null;
  return key;
}

function getHost(): string {
  return process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';
}

/**
 * Lazily initialize PostHog. Safe to call multiple times — only the first
 * call performs the dynamic import and `posthog.init()`. Returns null in
 * SSR, when the flag is off, when the key is missing, or when the dynamic
 * import fails (e.g., package not installed).
 */
async function ensurePosthog(): Promise<PosthogModule | null> {
  if (typeof window === 'undefined') return null;
  if (posthogInstance) return posthogInstance;
  if (initPromise) return initPromise;

  const key = getKey();
  if (!key) return null;

  initPromise = (async () => {
    try {
      // Dynamic import keeps posthog-js out of the main bundle.
      // If the package is not installed, this throws and we silently no-op.
      const mod = await import('posthog-js');
      const posthog = mod.default;
      posthog.init(key, {
        api_host: getHost(),
        capture_pageview: true,
        capture_pageleave: true,
        // P13: never autocollect form fields, all input is opt-in via track().
        autocapture: false,
        // P13: respect Do-Not-Track and disable in dev unless explicitly forced.
        respect_dnt: true,
        // Disable session recording by default — must be enabled per-cohort if needed.
        disable_session_recording: true,
        person_profiles: 'identified_only',
        loaded: () => {
          // Mark as ready; future track() calls will dispatch directly.
          posthogInstance = posthog;
        },
      });
      posthogInstance = posthog;
      return posthog;
    } catch {
      // Package not installed or init failed — no-op forever.
      return null;
    }
  })();

  return initPromise;
}

/**
 * Capture an event. Dual-dispatch is handled in `analytics.ts`; this is
 * the PostHog half. Fire-and-forget — never awaited by callers.
 */
export function posthogCapture(event: string, properties: Record<string, unknown>): void {
  // Don't await: keep `track()` synchronous-feeling.
  void ensurePosthog().then((ph) => {
    if (!ph) return;
    try {
      ph.capture(event, properties);
    } catch { /* analytics never throws */ }
  });
}

/**
 * Identify a user by a hashed ID. NEVER pass the raw auth UUID — use the
 * 16-hex-char SHA-256 prefix produced by `hashUserIdForAnalytics()`.
 *
 * Idempotent: re-calling with the same hash is a no-op.
 */
export function posthogIdentify(userIdHash: string, traits?: Record<string, unknown>): void {
  if (!userIdHash || userIdHash.length < 8) return;
  if (identifiedHash === userIdHash) return;
  identifiedHash = userIdHash;

  void ensurePosthog().then((ph) => {
    if (!ph) return;
    try {
      ph.identify(userIdHash, traits);
    } catch { /* analytics never throws */ }
  });
}

/** Reset PostHog identity (call on logout to prevent cross-user attribution). */
export function posthogReset(): void {
  identifiedHash = null;
  void ensurePosthog().then((ph) => {
    if (!ph) return;
    try {
      ph.reset();
    } catch { /* analytics never throws */ }
  });
}

/**
 * Hash a user ID for analytics. Uses SHA-256 then truncates to 16 hex chars
 * (8 bytes / 64 bits) — enough entropy to keep cohorts distinct, low enough
 * that the original UUID can't be recovered.
 *
 * Returns null if Web Crypto isn't available (SSR or very old browsers).
 */
export async function hashUserIdForAnalytics(userId: string): Promise<string | null> {
  if (!userId || typeof crypto === 'undefined' || !crypto.subtle) return null;
  try {
    const buf = new TextEncoder().encode(userId);
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest).slice(0, 8))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return null;
  }
}

/** True iff the PostHog dual-dispatch is currently enabled at runtime. */
export function isPosthogEnabled(): boolean {
  return getKey() !== null;
}
