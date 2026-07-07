/**
 * useTeacherGradebookDepth — Phase 3A Wave C client hook.
 *
 * Resolves `ff_teacher_gradebook_depth`, the ADDITIONAL gate for the MASTERY +
 * BLOOM'S reporting depth layered onto two existing teacher surfaces:
 *   1. Command Center — heatmap cells / student rows become a drill-through that
 *      opens the lazy-loaded Student Mastery Report panel.
 *   2. `/teacher/grade-book` — surfaces the class mastery/Bloom depth view above
 *      the existing score matrix.
 *
 * Flash-avoidance + byte-identical-OFF discipline mirror `useTeacherCommandCenter`
 * and `useTeacherAssignmentLifecycle` exactly:
 *   - The flag DEFAULTS OFF and is unseeded, so the resolved value is OFF for
 *     every current user. We initialise to `false` (DEFAULT_OFF) so the first
 *     paint is the legacy surface (heatmap cell = plain navigate link; gradebook
 *     = score matrix only) — exactly what "byte-identical when OFF" requires.
 *   - A small localStorage cache (1-hour TTL) lets a teacher who HAS the flag on
 *     (post-rollout) skip the legacy→depth flicker on repeat visits.
 *   - The async `getFeatureFlags` fetch then confirms/corrects and re-caches.
 *
 * Kept as a separate hook (rather than reusing the CC or Wave B hooks) because
 * the three flags are independent: a tenant can run the Command Center WITHOUT
 * the Wave C reporting depth during the staged rollout.
 */

import { useEffect, useState } from 'react';
import { getFeatureFlags } from './supabase';
import { TEACHER_GRADEBOOK_DEPTH_FLAGS } from './feature-flags';

// gitleaks:allow — localStorage key, not a secret.
const CACHE_KEY = 'alfanumrik_teacher_gradebook_depth_flag_v1'; // gitleaks:allow
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
 * React hook: returns `true` when the Wave C gradebook/reporting depth should be
 * surfaced. Initial value is read synchronously from cache (no flicker on repeat
 * visits); an async fetch confirms/corrects and re-caches.
 */
export function useTeacherGradebookDepth(): boolean {
  const [enabled, setEnabled] = useState<boolean>(() => getFlagSync());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const flags = await getFeatureFlags({ role: 'teacher' });
        if (cancelled) return;
        const resolved = Boolean(flags[TEACHER_GRADEBOOK_DEPTH_FLAGS.V1]);
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
