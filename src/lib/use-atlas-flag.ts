/**
 * useAtlasFlag — the one hook every Editorial Atlas dispatcher uses.
 *
 * Problem this solves:
 *   Each page (`/dashboard`, `/parent`, `/teacher`, `/school-admin`) and
 *   each legacy shell (`ParentShell`, `TeacherShell`, `SchoolAdminShell`)
 *   was independently fetching feature flags via `getFeatureFlags()` and
 *   gating on the result. On every visit:
 *     1. First render: atlasOn === null → render legacy chrome
 *     2. Async fetch resolves
 *     3. Second render: atlasOn === true → swap to Atlas chrome
 *   That visible flash is what the user sees as "the dashboard is
 *   fluctuating again and again." Three layers (page dispatcher + legacy
 *   shell pass-through + sometimes a spinner) stack into 2–3 flashes per
 *   page load.
 *
 * Fix:
 *   - LocalStorage caches the resolved flag per role with a 1-hour TTL.
 *   - The hook initializes synchronously from cache, so the very first
 *     paint matches the user's actual flag state on every repeat visit.
 *   - First-ever visit (no cache): default to `true` because the master
 *     flag is on globally in production. The async fetch then either
 *     confirms (no re-render) or corrects to false (one-time flash, only
 *     for the very first visit after a flag flip-off).
 *   - All shells + page dispatchers share this single hook, so the
 *     re-render decisions happen at the same React tick instead of
 *     cascading across nested components.
 *
 * Cache shape (localStorage key `alfanumrik_atlas_flags_v1`):
 *   {
 *     "student":  boolean,
 *     "parent":   boolean,
 *     "teacher":  boolean,
 *     "school":   boolean,
 *     "ts":       number   // Date.now() of last fetch
 *   }
 *
 * Cache invalidation:
 *   - Implicit TTL after 1 hour.
 *   - Explicit: call `clearAtlasFlagCache()` on sign-out / role-switch.
 */

import { useEffect, useState } from 'react';
import { getFeatureFlags } from './supabase';
import { isAtlasEnabled } from './feature-flags';

export type AtlasRole = 'student' | 'parent' | 'teacher' | 'school';

const CACHE_KEY = 'alfanumrik_atlas_flags_v1';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_ON = true; // master flag is enabled globally; safest assumption

interface CachedFlags {
  student: boolean;
  parent: boolean;
  teacher: boolean;
  school: boolean;
  ts: number;
}

function readCache(): CachedFlags | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedFlags;
    if (!parsed || typeof parsed.ts !== 'number') return null;
    if (Date.now() - parsed.ts > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(flags: Omit<CachedFlags, 'ts'>) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ ...flags, ts: Date.now() }),
    );
  } catch {
    /* quota or disabled storage — fall back to per-request fetch */
  }
}

export function clearAtlasFlagCache() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(CACHE_KEY);
  } catch {
    /* non-fatal */
  }
}

/**
 * Synchronous read of the cached Atlas flag for a role. Returns the
 * cached value if fresh, otherwise the DEFAULT_ON constant. Never
 * returns null — every render decides immediately. The async fetch
 * in `useAtlasFlag` updates the cache for future renders.
 */
export function getAtlasFlagSync(role: AtlasRole): boolean {
  const cached = readCache();
  if (cached) return cached[role];
  return DEFAULT_ON;
}

/**
 * React hook: returns `true` if Atlas should render for this role.
 *
 * Initial value is read synchronously from cache (no first-render flash).
 * After mount, an async `getFeatureFlags` call confirms or corrects, and
 * persists the result to cache for subsequent visits.
 */
export function useAtlasFlag(role: AtlasRole): boolean {
  const [enabled, setEnabled] = useState<boolean>(() => getAtlasFlagSync(role));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const flags = await getFeatureFlags();
        if (cancelled) return;
        const resolved = {
          student: isAtlasEnabled('student', flags),
          parent:  isAtlasEnabled('parent',  flags),
          teacher: isAtlasEnabled('teacher', flags),
          school:  isAtlasEnabled('school',  flags),
        };
        writeCache(resolved);
        // Only re-render if the resolved value differs from the
        // cached/optimistic state — avoids gratuitous re-renders.
        if (resolved[role] !== enabled) setEnabled(resolved[role]);
      } catch {
        /* network/auth failure — keep optimistic value */
      }
    })();
    return () => { cancelled = true; };
    // We intentionally do not depend on `enabled` to avoid a refetch
    // loop. The fetch runs once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  return enabled;
}
