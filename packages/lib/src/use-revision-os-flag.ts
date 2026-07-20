/**
 * useRevisionOsFlag — single client-side reader for `ff_revision_os_v1`.
 *
 * Gates the "Alfa OS" Revision Center (Tier 1, presentation-only) mounted at
 * the NEW route /revision. When ON, /revision renders the spaced-repetition
 * Revision Center over GET /api/revision/overview. When OFF, /revision does not
 * exist (the page calls notFound()), so the route stays purely additive — no
 * existing surface changes. Mirrors the proven `use-subjects-os-flag` shape
 * (synchronous first paint from a TTL-cached value, async confirm/correct on
 * mount) with the same critical contract:
 *
 *   DEFAULT IS OFF.
 *
 * The flag is not seeded in any environment yet and the OFF path must behave as
 * a non-existent route (404). So the first-ever paint (no cache) resolves to
 * false — /revision 404s — and the async `getFeatureFlags()` only flips us ON
 * if the DB row is explicitly enabled. This guarantees production users who
 * shouldn't see the Revision Center never get a flash of it.
 *
 * Cache shape (localStorage key `alfanumrik_revision_os_flag_v1`):
 *   { on: boolean, ts: number }
 * 5-minute TTL.
 */

import { useEffect, useState } from 'react';
import { getFeatureFlags } from './supabase';
import { REVISION_OS_FLAGS } from './feature-flags';

// gitleaks:allow — localStorage key, not a secret.
const CACHE_KEY = 'alfanumrik_revision_os_flag_v1'; // gitleaks:allow
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes — matches the server flag cache (feature-flag RCA)
const DEFAULT_OFF = false; // production truth: Revision Center is OFF until explicitly flagged on

interface Cached {
  on: boolean;
  ts: number;
}

/**
 * DEV/PREVIEW-ONLY override. Lets the Alfa OS Revision Center be previewed on
 * localhost without seeding the DB flag. STRICT no-op in production builds
 * (`NODE_ENV === 'production'`), so it is commit-safe.
 *
 * Enable (in the browser console at localhost, then refresh):
 *   localStorage.setItem('alfanumrik_force_revision_os', '1')
 * Disable:
 *   localStorage.removeItem('alfanumrik_force_revision_os')
 *
 * When set, this override WINS over the DB value: it short-circuits the
 * synchronous read and survives the async DB reconcile (so the preview cannot
 * be turned back off by a DB row that is OFF).
 */
function devForcedOn(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem('alfanumrik_force_revision_os') === '1'; // gitleaks:allow
  } catch {
    return false;
  }
}

function readCache(): boolean | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Cached;
    if (!parsed || typeof parsed.ts !== 'number') return null;
    if (Date.now() - parsed.ts > CACHE_TTL_MS) return null;
    return Boolean(parsed.on);
  } catch {
    return null;
  }
}

function writeCache(on: boolean) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({ on, ts: Date.now() }));
  } catch {
    /* quota / disabled storage — fall back to per-mount fetch */
  }
}

export function clearRevisionOsFlagCache() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(CACHE_KEY);
  } catch {
    /* non-fatal */
  }
}

/** Synchronous read: cached fresh value, else OFF. Never returns null. */
export function getRevisionOsFlagSync(): boolean {
  if (devForcedOn()) return true;
  const cached = readCache();
  if (cached !== null) return cached;
  return DEFAULT_OFF;
}

/**
 * Tri-state resolution status. The /revision page needs to distinguish
 * "still resolving" from "resolved OFF" so it does not 404 (notFound()) on the
 * very first client paint before the async DB read settles — that would flash a
 * 404 for a legitimately-ON user. `pending` = not yet confirmed by the async
 * fetch; `on`/`off` = resolved.
 */
export type RevisionOsFlagState = 'pending' | 'on' | 'off';

/**
 * Returns the tri-state resolution of `ff_revision_os_v1`. Optimistic first
 * value from cache (defaults OFF) but reported as `pending` until the async
 * `getFeatureFlags()` confirms, so the page can show a skeleton instead of
 * 404-ing prematurely. A dev override resolves to `on` immediately.
 */
export function useRevisionOsFlag(): RevisionOsFlagState {
  const [state, setState] = useState<RevisionOsFlagState>(() =>
    devForcedOn() ? 'on' : 'pending'
  );

  useEffect(() => {
    let cancelled = false;
    if (devForcedOn()) {
      setState('on');
      return;
    }
    (async () => {
      try {
        const flags = await getFeatureFlags();
        if (cancelled) return;
        const on = devForcedOn() || Boolean(flags?.[REVISION_OS_FLAGS.V1]);
        writeCache(on);
        setState(on ? 'on' : 'off');
      } catch {
        // network/auth failure — fall back to the cached/synchronous value so a
        // transient flag-read error doesn't 404 a legitimately-ON user.
        if (cancelled) return;
        setState(getRevisionOsFlagSync() ? 'on' : 'off');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
