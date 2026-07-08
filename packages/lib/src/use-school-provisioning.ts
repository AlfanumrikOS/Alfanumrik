/**
 * useSchoolProvisioning — the single client hook that gates the Phase 3B Wave B
 * SEAT-ENFORCEMENT UI on the school-admin provisioning surfaces (enroll page,
 * invite-codes page, and the Command Center seat-gauge augmentation).
 *
 * It mirrors `useSchoolCommandCenter` (src/lib/use-school-command-center.ts)
 * EXACTLY in structure — only the flag name + cache key differ. The seat
 * enforcement itself is SERVER-authoritative (the API routes call
 * `isFeatureEnabled('ff_school_provisioning', …)`); this client hook is purely a
 * UI gate so the new warning/blocking surfaces render only once enforcement is
 * actually live. It is NOT a security boundary (P9).
 *
 * Flash-avoidance + byte-identical-OFF discipline (identical to the Command
 * Center hook):
 *   - The flag DEFAULTS OFF and is not yet seeded in `feature_flags`, so the
 *     resolved value is OFF for every current user. We initialise to `false`
 *     (DEFAULT_OFF) — the very first paint shows today's provisioning surfaces,
 *     which is exactly what "byte-identical when OFF" requires. There is no
 *     first-paint flash for production users (flag absent ⇒ stays false).
 *   - A small localStorage cache (1-hour TTL) lets an admin who HAS the flag on
 *     (post-rollout) skip the OFF→ON flash on repeat visits: the cached `true`
 *     is read synchronously on mount.
 *   - The async `getFeatureFlags` fetch then confirms/corrects and re-caches.
 *
 * Kept separate from the Command Center hook because the cache key + the gated
 * surface differ; the structure is otherwise identical so the two flag hooks
 * read the same way.
 */

import { useEffect, useState } from 'react';
import { getFeatureFlags } from './supabase';
import { SCHOOL_PROVISIONING_FLAGS } from './feature-flags';

// gitleaks:allow — localStorage key, not a secret.
const CACHE_KEY = 'alfanumrik_school_provisioning_flag_v1'; // gitleaks:allow
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_OFF = false; // flag unseeded ⇒ resolves OFF; legacy is the safe paint

interface CachedFlag {
  enabled: boolean;
  ts: number;
}

function readCache(): boolean | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedFlag;
    if (!parsed || typeof parsed.ts !== 'number' || typeof parsed.enabled !== 'boolean') {
      return null;
    }
    if (Date.now() - parsed.ts > CACHE_TTL_MS) return null;
    return parsed.enabled;
  } catch {
    return null;
  }
}

function writeCache(enabled: boolean) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({ enabled, ts: Date.now() }));
  } catch {
    /* quota or disabled storage — fall back to per-request fetch */
  }
}

/** Synchronous read of the cached flag; DEFAULT_OFF when no fresh cache. */
function getFlagSync(): boolean {
  const cached = readCache();
  return cached ?? DEFAULT_OFF;
}

/**
 * React hook: returns `true` when the seat-enforcement UI should render.
 * Initial value is read synchronously from cache (no first-render flash on
 * repeat visits); an async fetch confirms/corrects and re-caches.
 */
export function useSchoolProvisioning(): boolean {
  const [enabled, setEnabled] = useState<boolean>(() => getFlagSync());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const flags = await getFeatureFlags({ role: 'school_admin' });
        if (cancelled) return;
        const resolved = Boolean(flags[SCHOOL_PROVISIONING_FLAGS.V1]);
        writeCache(resolved);
        if (resolved !== enabled) setEnabled(resolved);
      } catch {
        /* network/auth failure — keep optimistic (default-OFF) value */
      }
    })();
    return () => {
      cancelled = true;
    };
    // Fetch runs once per mount; intentionally not depending on `enabled`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return enabled;
}
