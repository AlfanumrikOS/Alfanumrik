/**
 * useSchoolReportsDepth — the single client hook that gates the Phase 3B Wave D
 * SCHOOL-WIDE ACADEMIC REPORTING DEPTH UI (the board/parent-ready mastery +
 * Bloom's reports + export surface) AND its Academics-section nav entry.
 *
 * It mirrors `useSchoolProvisioning` (src/lib/use-school-provisioning.ts) and
 * `useSchoolCommandCenter` EXACTLY in structure — only the flag name + cache key
 * differ. The reporting endpoints are SERVER-authoritative (the three read routes
 * 404 BEFORE auth when `ff_school_reports_depth` is OFF); this client hook is
 * purely a UI gate so the new reporting surface + its nav link render only once
 * the flag is actually live. It is NOT a security boundary (P9).
 *
 * Flash-avoidance + byte-identical-OFF discipline (identical to the sibling
 * hooks):
 *   - The flag DEFAULTS OFF and is not yet seeded in `feature_flags`, so the
 *     resolved value is OFF for every current user. We initialise to `false`
 *     (DEFAULT_OFF) — the very first paint shows today's portal (no reporting
 *     surface, no nav link), which is exactly what "byte-identical when OFF"
 *     requires. There is no first-paint flash for production users (flag absent
 *     ⇒ stays false).
 *   - A small localStorage cache (1-hour TTL) lets an admin who HAS the flag on
 *     (post-rollout) skip the OFF→ON flash on repeat visits: the cached `true`
 *     is read synchronously on mount.
 *   - The async `getFeatureFlags` fetch then confirms/corrects and re-caches.
 *
 * Kept separate from the sibling hooks because the cache key + the gated surface
 * differ; the structure is otherwise identical so all the flag hooks read the
 * same way.
 */

import { useEffect, useState } from 'react';
import { getFeatureFlags } from './supabase';
import { SCHOOL_REPORTS_DEPTH_FLAGS } from './feature-flags';

// gitleaks:allow — localStorage key, not a secret.
const CACHE_KEY = 'alfanumrik_school_reports_depth_flag_v1'; // gitleaks:allow
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
 * React hook: returns `true` when the school-wide reporting-depth UI (and its
 * nav entry) should render. Initial value is read synchronously from cache (no
 * first-render flash on repeat visits); an async fetch confirms/corrects and
 * re-caches.
 */
export function useSchoolReportsDepth(): boolean {
  const [enabled, setEnabled] = useState<boolean>(() => getFlagSync());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const flags = await getFeatureFlags({ role: 'school_admin' });
        if (cancelled) return;
        const resolved = Boolean(flags[SCHOOL_REPORTS_DEPTH_FLAGS.V1]);
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
