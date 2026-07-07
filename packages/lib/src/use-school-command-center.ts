/**
 * useSchoolCommandCenter — the single client hook both school-admin surfaces use
 * to decide whether the Phase 3B "School Command Center" renders.
 *
 * Two surfaces gate on the SAME flag (`ff_school_command_center`):
 *   1. `/school-admin` — Command Center home vs the legacy stat-tile dashboard.
 *   2. SchoolAdminShell primary nav — consolidated 5-section nav vs the legacy
 *      flat nav.
 *
 * Flash-avoidance + byte-identical-OFF discipline (mirrors
 * `useTeacherCommandCenter` intentionally):
 *   - The flag DEFAULTS OFF and is not yet seeded in `feature_flags`, so the
 *     resolved value is OFF for every current user. We therefore initialise the
 *     hook to `false` (DEFAULT_OFF) — the very first paint is the legacy
 *     surface, which is exactly what "byte-identical when OFF" requires. There
 *     is no first-paint flash for production users (flag absent ⇒ stays false).
 *   - A small localStorage cache (1-hour TTL) lets an admin who HAS the flag on
 *     (post-rollout) skip the legacy→CC flash on repeat visits: the cached
 *     `true` is read synchronously on mount.
 *   - The async `getFeatureFlags` fetch then confirms/corrects and re-caches.
 *
 * Kept separate from the teacher hook because the cache key + role context
 * differ; the structure is otherwise identical so the two flag hooks read the
 * same way.
 */

import { useEffect, useState } from 'react';
import { getFeatureFlags } from './supabase';
import { SCHOOL_COMMAND_CENTER_FLAGS } from './feature-flags';

// gitleaks:allow — localStorage key, not a secret.
const CACHE_KEY = 'alfanumrik_school_cc_flag_v1'; // gitleaks:allow
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
 * React hook: returns `true` when the School Command Center should render.
 * Initial value is read synchronously from cache (no first-render flash on
 * repeat visits); an async fetch confirms/corrects and re-caches.
 */
export function useSchoolCommandCenter(): boolean {
  const [enabled, setEnabled] = useState<boolean>(() => getFlagSync());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const flags = await getFeatureFlags({ role: 'school_admin' });
        if (cancelled) return;
        const resolved = Boolean(flags[SCHOOL_COMMAND_CENTER_FLAGS.V1]);
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
