/**
 * useTeacherAssignmentLifecycle — Phase 3A Wave B client hook.
 *
 * Resolves `ff_teacher_assignment_lifecycle`, the ADDITIONAL gate (layered on
 * top of `ff_teacher_command_center`) for the cross-assignment GRADING QUEUE
 * inside the Command Center. The Command Center reads this to decide whether to:
 *   1. fetch `get_grading_queue` and badge the "awaiting grading" tile, and
 *   2. enable the action-bar "Grading queue" button + open the queue surface.
 *
 * Flash-avoidance + byte-identical-OFF discipline mirrors
 * `useTeacherCommandCenter` exactly:
 *   - The flag DEFAULTS OFF and is unseeded, so the resolved value is OFF for
 *     every current user. We initialise to `false` (DEFAULT_OFF) so the first
 *     paint keeps the disabled "Grading queue" placeholder — exactly what
 *     "byte-identical when OFF" requires.
 *   - A small localStorage cache (1-hour TTL) lets a teacher who HAS the flag on
 *     (post-rollout) skip the disabled→enabled flicker on repeat visits.
 *   - The async `getFeatureFlags` fetch then confirms/corrects and re-caches.
 *
 * Kept as a separate hook (rather than reusing the CC hook) because the two
 * flags are independent: a tenant can run the Command Center WITHOUT the Wave B
 * grading queue during the staged rollout.
 */

import { useEffect, useState } from 'react';
import { getFeatureFlags } from './supabase';
import { TEACHER_ASSIGNMENT_LIFECYCLE_FLAGS } from './feature-flags';

// gitleaks:allow — localStorage key, not a secret.
const CACHE_KEY = 'alfanumrik_teacher_assignment_lifecycle_flag_v1'; // gitleaks:allow
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_OFF = false; // flag unseeded ⇒ resolves OFF; placeholder is the safe paint

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
 * React hook: returns `true` when the Wave B grading queue should be surfaced.
 * Initial value is read synchronously from cache (no flicker on repeat visits);
 * an async fetch confirms/corrects and re-caches.
 */
export function useTeacherAssignmentLifecycle(): boolean {
  const [enabled, setEnabled] = useState<boolean>(() => getFlagSync());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const flags = await getFeatureFlags({ role: 'teacher' });
        if (cancelled) return;
        const resolved = Boolean(flags[TEACHER_ASSIGNMENT_LIFECYCLE_FLAGS.V1]);
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
